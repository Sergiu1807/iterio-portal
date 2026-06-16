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

export async function fetchExternalMedia(
  url: string,
  opts?: { maxBytes?: number }
): Promise<{ buffer: Buffer; contentType: string } | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (!(await assertPublicHost(u.hostname))) return null;

  const maxBytes = opts?.maxBytes ?? 200 * 1024 * 1024; // 200 MB
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(45_000), redirect: "follow" });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  // post-redirect re-check: the final URL host must also be public
  try {
    const finalHost = new URL(res.url).hostname;
    if (finalHost !== u.hostname && !(await assertPublicHost(finalHost))) return null;
  } catch {
    return null;
  }

  const contentType = res.headers.get("content-type") || "application/octet-stream";
  if (!/^(image|video)\//.test(contentType)) return null;
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) return null;

  const ab = await res.arrayBuffer();
  if (ab.byteLength > maxBytes) return null;
  return { buffer: Buffer.from(ab), contentType };
}

export function extFromContentType(ct: string): string {
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("webm")) return "webm";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}
