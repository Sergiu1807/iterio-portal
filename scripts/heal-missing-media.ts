/* Heal competitor_ads rows that have NO stored media by re-capturing from the
 * RETAINED Apify dataset (dataset reads are free — no new actor run). Mirrors the
 * media-URL precedence in normalizeMetaAd + captureMedia.
 * Dry-run: npx tsx scripts/heal-missing-media.ts            (lists what it would do)
 * Apply:   npx tsx scripts/heal-missing-media.ts --apply */
import { config } from "dotenv";
config({ path: ".env.local" });
import crypto from "node:crypto";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const BUCKET = "iterio-portal-assets";
const MAX_CARDS = 10;

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function decryptKey(encrypted: string): string {
  const key = crypto.createHash("sha256").update(process.env.API_KEYS_ENCRYPTION_SECRET!.trim()).digest();
  const [ivHex, tagHex, data] = encrypted.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return d.update(data, "hex", "utf8") + d.final("utf8");
}
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

// ---- media URL extraction (verbatim precedence from normalizeMetaAd) ----
function extractMedia(raw: Record<string, any>) {
  const snap = raw?.snapshot ?? {};
  const videos = Array.isArray(snap?.videos) ? snap.videos : [];
  const images = Array.isArray(snap?.images) ? snap.images : [];
  const cards = Array.isArray(snap?.cards) ? snap.cards : [];
  const displayFormat = str(snap?.display_format)?.toUpperCase();
  let mediaType: "video" | "image" | "carousel" | "text" = "text";
  let thumbnailUrl: string | undefined;
  let videoUrl: string | undefined;
  const carouselImageUrls: string[] = [];
  const carouselVideoUrls: string[] = [];
  if (videos.length) {
    mediaType = "video";
    videoUrl = str(videos[0]?.video_hd_url) ?? str(videos[0]?.video_sd_url);
    thumbnailUrl = str(videos[0]?.video_preview_image_url) ?? str(images[0]?.original_image_url) ?? str(cards[0]?.original_image_url);
  } else if (cards.length >= 2 || displayFormat === "CAROUSEL" || displayFormat === "DPA") {
    mediaType = "carousel";
    for (const c of cards.slice(0, MAX_CARDS)) {
      const img = str(c?.original_image_url) ?? str(c?.resized_image_url) ?? str(c?.video_preview_image_url);
      if (img) carouselImageUrls.push(img);
      const cv = str(c?.video_hd_url) ?? str(c?.video_sd_url);
      if (cv) carouselVideoUrls.push(cv);
    }
    thumbnailUrl = carouselImageUrls[0];
    if (carouselVideoUrls.length) videoUrl = carouselVideoUrls[0];
  } else if (cards.length === 1) {
    mediaType = "image";
    thumbnailUrl = str(cards[0]?.original_image_url) ?? str(cards[0]?.resized_image_url);
    const cv = str(cards[0]?.video_hd_url) ?? str(cards[0]?.video_sd_url);
    if (cv) { mediaType = "video"; videoUrl = cv; }
  } else if (images.length) {
    mediaType = "image";
    thumbnailUrl = str(images[0]?.original_image_url) ?? str(images[0]?.resized_image_url);
  }
  return { mediaType, thumbnailUrl, videoUrl, carouselImageUrls };
}

function extFromCt(ct: string): string {
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("webm")) return "webm";
  if (ct.includes("quicktime") || ct.includes("mov")) return "mov";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}
function ctFromUrl(url: string): string {
  const p = url.split("?")[0].toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".mp4")) return "video/mp4";
  if (p.endsWith(".mov")) return "video/quicktime";
  return "image/jpeg";
}
function storagePath(slug: string, kind: string, file: string) {
  const s = (slug || "brand").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return `brands/${s}/${kind}/${file}`;
}

async function store(slug: string, aid: string, name: string, url: string, maxBytes: number): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000), redirect: "follow" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return null;
    let ct = res.headers.get("content-type") || "";
    if (!/^(image|video)\//.test(ct)) ct = ctFromUrl(url);
    const path = storagePath(slug, "scraped-meta-ads", `${aid}-${name}.${extFromCt(ct)}`);
    const { error } = await supa.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: true });
    if (error) { console.warn("    upload error", error.message); return null; }
    return path;
  } catch (e) {
    console.warn("    fetch error", String(e).slice(0, 80));
    return null;
  }
}

async function main() {
  // rows with NO stored media (skip text ads — nothing to capture)
  const rows = await sql<
    { id: string; ad_archive_id: string; brand_slug: string; media_type: string | null; scrape_job_id: string | null; dataset: string | null; ai_analysis_status: string }[]
  >`
    SELECT ca.id, ca.ad_archive_id, b.slug AS brand_slug, ca.media_type, ca.scrape_job_id,
           sj.apify_dataset_id AS dataset, ca.ai_analysis_status
    FROM competitor_ads ca
    JOIN brands b ON b.id = ca.brand_id
    LEFT JOIN scrape_jobs sj ON sj.id = ca.scrape_job_id
    WHERE coalesce(ca.media_type,'') <> 'text'
      AND ca.primary_thumbnail IS NULL AND ca.video_path IS NULL
      AND (ca.media_cards IS NULL OR jsonb_array_length(ca.media_cards) = 0)`;

  console.log(`${rows.length} rows with no stored media${APPLY ? "" : "  (DRY RUN — pass --apply to heal)"}`);
  const withDataset = rows.filter((r) => r.dataset);
  const noDataset = rows.length - withDataset.length;
  if (noDataset) console.log(`  ${noDataset} have no retained dataset (need a re-scrape to heal)`);

  // group by dataset to fetch each once
  const byDataset = new Map<string, typeof rows>();
  for (const r of withDataset) {
    const arr = byDataset.get(r.dataset!) ?? [];
    arr.push(r);
    byDataset.set(r.dataset!, arr as typeof rows);
  }

  const [keyRow] = await sql<{ encrypted_value: string }[]>`SELECT encrypted_value FROM api_keys WHERE key_name='APIFY_TOKEN' LIMIT 1`;
  const token = decryptKey(keyRow.encrypted_value);

  let healed = 0, stillNone = 0;
  for (const [dataset, list] of byDataset) {
    const res = await fetch(`https://api.apify.com/v2/datasets/${dataset}/items?clean=true&token=${token}`);
    if (!res.ok) { console.log(`dataset ${dataset}: HTTP ${res.status} (expired) — ${list.length} rows need re-scrape`); continue; }
    const items = (await res.json()) as Record<string, any>[];
    const byAid = new Map<string, Record<string, any>>();
    for (const it of items) {
      const aid = String(it?.ad_archive_id ?? it?.adArchiveID ?? it?.adArchiveId ?? "");
      if (aid) byAid.set(aid, it);
    }
    for (const r of list) {
      const raw = byAid.get(r.ad_archive_id);
      if (!raw) { console.log(`  ${r.ad_archive_id}: not in dataset`); continue; }
      const m = extractMedia(raw);
      const hasUrls = !!(m.thumbnailUrl || m.videoUrl || m.carouselImageUrls.length);
      console.log(`  ${r.ad_archive_id} [${m.mediaType}] urls: thumb=${m.thumbnailUrl ? "Y" : "·"} video=${m.videoUrl ? "Y" : "·"} cards=${m.carouselImageUrls.length}`);
      if (!hasUrls) { stillNone++; continue; }
      if (!APPLY) { healed++; continue; }

      // capture (mirror captureMedia)
      let mediaCards: string[] = [];
      if (m.mediaType === "carousel" && m.carouselImageUrls.length) {
        const settled = await Promise.all(m.carouselImageUrls.slice(0, MAX_CARDS).map((u, i) => store(r.brand_slug, r.ad_archive_id, `card${i}`, u, 25 * 1024 * 1024)));
        mediaCards = settled.filter((p): p is string => !!p);
      }
      let thumbPath: string | null = m.mediaType === "carousel" ? mediaCards[0] ?? null : m.thumbnailUrl ? await store(r.brand_slug, r.ad_archive_id, "thumb", m.thumbnailUrl, 25 * 1024 * 1024) : null;
      const videoPath: string | null = m.videoUrl ? await store(r.brand_slug, r.ad_archive_id, "video", m.videoUrl, 200 * 1024 * 1024) : null;
      const full = videoPath ?? thumbPath ?? mediaCards[0] ?? null;
      if (!thumbPath && !videoPath && !mediaCards.length) { console.log("    → capture produced nothing"); stillNone++; continue; }

      const requeue = r.ai_analysis_status === "failed";
      await sql`
        UPDATE competitor_ads SET
          primary_thumbnail = ${thumbPath},
          video_path = ${videoPath},
          media_cards = ${sql.json(mediaCards)},
          full_media_asset = ${full},
          media_capture_failed = false,
          media_capture_attempts = greatest(media_capture_attempts, 1),
          source_media_urls = ${sql.json({ thumbnailUrl: m.thumbnailUrl, videoUrl: m.videoUrl, carouselImageUrls: m.carouselImageUrls })},
          ${requeue ? sql`ai_analysis_status = 'queued', ai_attempts = 0, ai_error_message = NULL,` : sql``}
          updated_at = now()
        WHERE id = ${r.id}`;
      console.log(`    → healed: thumb=${thumbPath ? "Y" : "·"} video=${videoPath ? "Y" : "·"} cards=${mediaCards.length}${requeue ? " (re-queued analysis)" : ""}`);
      healed++;
    }
  }

  console.log(`\n${APPLY ? "Healed" : "Would heal"}: ${healed}   still-no-media (genuinely no URLs): ${stillNone}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
