/* Heal competitor_ads media from the RETAINED Apify dataset (dataset reads are
 * free — no new actor run). Two cases:
 *   1) rows with NO stored media at all, and
 *   2) carousels missing per-card media_card_items (so the viewer can show ALL slides).
 * Mirrors normalizeMetaAd + captureMedia (incl. per-card image+video).
 * Dry-run: npx tsx scripts/heal-missing-media.ts            Apply: ... --apply */
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

type Card = { imageUrl?: string; videoUrl?: string };
function extractMedia(raw: Record<string, any>) {
  const snap = raw?.snapshot ?? {};
  const videos = Array.isArray(snap?.videos) ? snap.videos : [];
  const images = Array.isArray(snap?.images) ? snap.images : [];
  const cards = Array.isArray(snap?.cards) ? snap.cards : [];
  const displayFormat = str(snap?.display_format)?.toUpperCase();
  let mediaType: "video" | "image" | "carousel" | "text" = "text";
  let thumbnailUrl: string | undefined;
  let videoUrl: string | undefined;
  const carouselCards: Card[] = [];
  if (videos.length) {
    mediaType = "video";
    videoUrl = str(videos[0]?.video_hd_url) ?? str(videos[0]?.video_sd_url);
    thumbnailUrl = str(videos[0]?.video_preview_image_url) ?? str(images[0]?.original_image_url) ?? str(cards[0]?.original_image_url);
  } else if (cards.length >= 2 || displayFormat === "CAROUSEL" || displayFormat === "DPA") {
    mediaType = "carousel";
    for (const c of cards.slice(0, MAX_CARDS)) {
      carouselCards.push({
        imageUrl: str(c?.original_image_url) ?? str(c?.resized_image_url) ?? str(c?.video_preview_image_url),
        videoUrl: str(c?.video_hd_url) ?? str(c?.video_sd_url),
      });
    }
    thumbnailUrl = carouselCards.find((c) => c.imageUrl)?.imageUrl;
    videoUrl = carouselCards.find((c) => c.videoUrl)?.videoUrl;
  } else if (cards.length === 1) {
    mediaType = "image";
    thumbnailUrl = str(cards[0]?.original_image_url) ?? str(cards[0]?.resized_image_url);
    const cv = str(cards[0]?.video_hd_url) ?? str(cards[0]?.video_sd_url);
    if (cv) { mediaType = "video"; videoUrl = cv; }
  } else if (images.length) {
    mediaType = "image";
    thumbnailUrl = str(images[0]?.original_image_url) ?? str(images[0]?.resized_image_url);
  }
  return { mediaType, thumbnailUrl, videoUrl, carouselCards };
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
function storagePath(slug: string, file: string) {
  const s = (slug || "brand").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return `brands/${s}/scraped-meta-ads/${file}`;
}
async function store(slug: string, aid: string, name: string, url: string, maxBytes: number): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000), redirect: "follow" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return null;
    let ct = res.headers.get("content-type") || "";
    if (!/^(image|video)\//.test(ct)) ct = ctFromUrl(url);
    const path = storagePath(slug, `${aid}-${name}.${extFromCt(ct)}`);
    const { error } = await supa.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: true });
    if (error) { console.warn("    upload error", error.message); return null; }
    return path;
  } catch (e) {
    console.warn("    fetch error", String(e).slice(0, 80));
    return null;
  }
}

async function main() {
  // Rows needing a heal: no stored media at all, OR a carousel missing per-card items.
  const rows = await sql<
    { id: string; ad_archive_id: string; brand_slug: string; media_type: string | null; dataset: string | null; ai_analysis_status: string }[]
  >`
    SELECT ca.id, ca.ad_archive_id, b.slug AS brand_slug, ca.media_type,
           sj.apify_dataset_id AS dataset, ca.ai_analysis_status
    FROM competitor_ads ca
    JOIN brands b ON b.id = ca.brand_id
    LEFT JOIN scrape_jobs sj ON sj.id = ca.scrape_job_id
    WHERE coalesce(ca.media_type,'') <> 'text'
      AND (
        (ca.primary_thumbnail IS NULL AND ca.video_path IS NULL AND (ca.media_cards IS NULL OR jsonb_array_length(ca.media_cards) = 0))
        OR (ca.media_type = 'carousel' AND (ca.media_card_items IS NULL OR jsonb_array_length(ca.media_card_items) = 0))
      )`;

  console.log(`${rows.length} rows to heal${APPLY ? "" : "  (DRY RUN — pass --apply)"}`);
  type Row = (typeof rows)[number];
  const byDataset = new Map<string, Row[]>();
  let noDataset = 0;
  for (const r of rows) {
    if (!r.dataset) { noDataset++; continue; }
    const arr = byDataset.get(r.dataset) ?? [];
    arr.push(r);
    byDataset.set(r.dataset, arr);
  }
  if (noDataset) console.log(`  ${noDataset} have no retained dataset (re-scrape to heal)`);

  const [keyRow] = await sql<{ encrypted_value: string }[]>`SELECT encrypted_value FROM api_keys WHERE key_name='APIFY_TOKEN' LIMIT 1`;
  const token = decryptKey(keyRow.encrypted_value);

  let healed = 0, skipped = 0;
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
      if (!raw) { console.log(`  ${r.ad_archive_id}: not in dataset`); skipped++; continue; }
      const m = extractMedia(raw);

      let cardItems: { image: string | null; video: string | null }[] = [];
      let mediaCards: string[] = [];
      let thumbPath: string | null = null;
      let videoPath: string | null = null;
      if (m.mediaType === "carousel" && m.carouselCards.length) {
        if (APPLY) {
          cardItems = await Promise.all(
            m.carouselCards.slice(0, MAX_CARDS).map(async (c, i) => ({
              image: c.imageUrl ? await store(r.brand_slug, r.ad_archive_id, `card${i}`, c.imageUrl, 25 * 1024 * 1024) : null,
              video: c.videoUrl ? await store(r.brand_slug, r.ad_archive_id, `card${i}v`, c.videoUrl, 200 * 1024 * 1024) : null,
            }))
          );
          mediaCards = cardItems.map((c) => c.image).filter((p): p is string => !!p);
          thumbPath = cardItems.find((c) => c.image)?.image ?? null;
          videoPath = cardItems.find((c) => c.video)?.video ?? null;
        }
      } else if (APPLY) {
        thumbPath = m.thumbnailUrl ? await store(r.brand_slug, r.ad_archive_id, "thumb", m.thumbnailUrl, 25 * 1024 * 1024) : null;
        videoPath = m.videoUrl ? await store(r.brand_slug, r.ad_archive_id, "video", m.videoUrl, 200 * 1024 * 1024) : null;
      }

      const nImg = m.carouselCards.filter((c) => c.imageUrl).length || (m.thumbnailUrl ? 1 : 0);
      const nVid = m.carouselCards.filter((c) => c.videoUrl).length || (m.videoUrl ? 1 : 0);
      console.log(`  ${r.ad_archive_id} [${m.mediaType}] cards=${m.carouselCards.length} img=${nImg} vid=${nVid}${APPLY ? ` → saved ${cardItems.length} items` : ""}`);
      if (!APPLY) { healed++; continue; }

      const full = videoPath ?? thumbPath ?? mediaCards[0] ?? null;
      const requeue = r.ai_analysis_status === "failed" && (thumbPath || videoPath || mediaCards.length);
      await sql`
        UPDATE competitor_ads SET
          media_card_items = ${sql.json(cardItems)},
          ${m.mediaType === "carousel" ? sql`
            primary_thumbnail = coalesce(primary_thumbnail, ${thumbPath}),
            video_path = coalesce(video_path, ${videoPath}),
            media_cards = case when jsonb_array_length(media_cards)=0 then ${sql.json(mediaCards)} else media_cards end,
            full_media_asset = coalesce(full_media_asset, ${full}),
            media_capture_failed = false,
            media_capture_attempts = greatest(media_capture_attempts, 1),
          ` : sql``}
          ${requeue ? sql`ai_analysis_status = 'queued', ai_attempts = 0, ai_error_message = NULL,` : sql``}
          updated_at = now()
        WHERE id = ${r.id}`;
      healed++;
    }
  }

  console.log(`\n${APPLY ? "Healed" : "Would heal"}: ${healed}   skipped: ${skipped}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
