import "server-only";
import dns from "node:dns/promises";
import net from "node:net";
import { supabaseAdmin } from "@/lib/supabase/admin";

const BUCKET = "iterio-portal-assets";

/** brands/<slug>/<kind>/<filename> — e.g. brands/naali/scraped-meta-ads/123.mp4 */
export function storagePath(brandSlug: string, kind: string, filename: string): string {
  const slug = (brandSlug || "brand").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const k = kind.replace(/[^a-z0-9-]/gi, "-");
  return `brands/${slug}/${k}/${filename}`;
}

export async function uploadToStorage(path: string, body: Buffer, contentType: string): Promise<string> {
  const { error } = await supabaseAdmin()
    .storage.from(BUCKET)
    .upload(path, body, { contentType, upsert: true });
  if (error) throw error;
  return path;
}

export async function signedUrl(path: string | null | undefined, expiresIn = 3600): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function downloadFromStorage(path: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(path);
  if (error || !data) throw error ?? new Error("storage download failed");
  return Buffer.from(await data.arrayBuffer());
}

// ---- SSRF + size guard for fetching untrusted (Apify/CDN) media URLs ----

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127") || v.startsWith("::ffff:10");
}

async function assertPublicHost(hostname: string): Promise<boolean> {
  if (hostname === "localhost" || hostname.endsWith(".internal") || hostname.endsWith(".local")) return false;
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/** Guess a media content-type from a URL path extension (fallback when the
 *  server omits or mislabels content-type — common on CDNs). */
function contentTypeFromUrl(url: string): string | null {
  const path = url.split("?")[0].toLowerCase();
  if (/\.(jpg|jpeg)$/.test(path)) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".mov")) return "video/quicktime";
  return null;
}

/** Sniff a media content-type from magic bytes (last-resort fallback). */
function sniffContentType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (buf.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  return null;
}

export async function fetchExternalMedia(
  url: string,
  opts?: { maxBytes?: number; timeoutMs?: number }
): Promise<{ buffer: Buffer; contentType: string } | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    console.warn("[media] reject", { reason: "bad-url" });
    return null;
  }
  if (u.protocol !== "https:") {
    console.warn("[media] reject", { host: u.hostname, reason: "protocol" });
    return null;
  }
  if (!(await assertPublicHost(u.hostname))) {
    console.warn("[media] reject", { host: u.hostname, reason: "ssrf-host" });
    return null;
  }

  const maxBytes = opts?.maxBytes ?? 200 * 1024 * 1024;
  const timeoutMs = opts?.timeoutMs ?? 20_000;

  // Bounded retry on transient failures (429/5xx/network/timeout).
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
      if (res.ok) break;
      if (res.status !== 429 && res.status < 500) {
        console.warn("[media] reject", { host: u.hostname, reason: `status ${res.status}` });
        return null; // non-retryable (e.g. 403/404)
      }
    } catch (e) {
      console.warn("[media] fetch error", { host: u.hostname, attempt, err: String(e).slice(0, 80) });
    }
    const retryAfter = Number(res?.headers.get("retry-after")) * 1000 || 0;
    await new Promise((r) => setTimeout(r, retryAfter || 500 * (attempt + 1)));
  }
  if (!res || !res.ok) {
    console.warn("[media] reject", { host: u.hostname, reason: `exhausted ${res?.status ?? "network"}` });
    return null;
  }

  // post-redirect host re-check
  try {
    const finalHost = new URL(res.url).hostname;
    if (finalHost !== u.hostname && !(await assertPublicHost(finalHost))) {
      console.warn("[media] reject", { host: finalHost, reason: "ssrf-redirect" });
      return null;
    }
  } catch {
    return null;
  }

  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    console.warn("[media] reject", { host: u.hostname, reason: `oversize-declared ${declared}` });
    return null;
  }

  const ab = await res.arrayBuffer();
  const buffer = Buffer.from(ab);
  if (buffer.byteLength > maxBytes) {
    console.warn("[media] reject", { host: u.hostname, reason: `oversize ${buffer.byteLength}` });
    return null;
  }

  // Resolve content-type: header → URL extension → magic-byte sniff.
  let contentType = res.headers.get("content-type") || "";
  if (!/^(image|video)\//.test(contentType)) {
    contentType = contentTypeFromUrl(url) || sniffContentType(buffer) || "";
  }
  if (!/^(image|video)\//.test(contentType)) {
    console.warn("[media] reject", { host: u.hostname, reason: `content-type ${res.headers.get("content-type") || "none"}` });
    return null;
  }

  return { buffer, contentType };
}

export function extFromContentType(ct: string): string {
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("webm")) return "webm";
  if (ct.includes("quicktime") || ct.includes("mov")) return "mov";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}
