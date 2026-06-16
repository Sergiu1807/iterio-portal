import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getApifyRun, listApifyDataset, recordApifyUsage } from "@/lib/providers/apify";
import { fetchExternalMedia, uploadToStorage, storagePath, extFromContentType } from "@/lib/storage";

const PER_PASS = 6; // videos are heavy — keep a cron pass under maxDuration
const MAX_CARDS = 10;
const SYSTEM_KEY = "competitor-research";

type Job = typeof schema.scrapeJobs.$inferSelect;

type NormalizedAd = {
  adArchiveId: string;
  pageId?: string;
  pageName?: string;
  adText?: string;
  headline?: string;
  ctaText?: string;
  linkUrl?: string;
  displayDomain?: string;
  mediaType: "video" | "image" | "carousel" | "text";
  thumbnailUrl?: string;
  videoUrl?: string;
  carouselImageUrls: string[];
  adLibraryUrl?: string;
  startDate?: Date;
  metaSortRank: number;
  isDco: boolean;
  collationId?: string;
  adGroupId?: string;
  publisherPlatforms: string[];
  platformsDisplay?: string;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

function toDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return new Date(n < 1e12 ? n * 1000 : n);
  const d = new Date(v as string);
  return isNaN(+d) ? undefined : d;
}

const PLATFORM_LABEL: Record<string, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  MESSENGER: "Messenger",
  AUDIENCE_NETWORK: "Audience Network",
  WHATSAPP: "WhatsApp",
  THREADS: "Threads",
};

function domainFrom(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export function normalizeMetaAd(raw: Record<string, any>, index: number): NormalizedAd | null {
  const snap = raw?.snapshot ?? {};
  const adArchiveId = String(
    raw?.adArchiveID ?? raw?.ad_archive_id ?? raw?.adArchiveId ?? snap?.ad_archive_id ?? raw?.id ?? ""
  ).trim();
  if (!adArchiveId) return null;

  const videos = Array.isArray(snap?.videos) ? snap.videos : [];
  const images = Array.isArray(snap?.images) ? snap.images : [];
  const cards = Array.isArray(snap?.cards) ? snap.cards : [];

  let mediaType: NormalizedAd["mediaType"] = "text";
  let thumbnailUrl: string | undefined;
  let videoUrl: string | undefined;
  const carouselImageUrls: string[] = [];

  if (videos.length) {
    mediaType = "video";
    videoUrl = str(videos[0]?.video_hd_url) ?? str(videos[0]?.video_sd_url);
    thumbnailUrl = str(videos[0]?.video_preview_image_url) ?? str(images[0]?.original_image_url) ?? str(cards[0]?.original_image_url);
  } else if (cards.length >= 2) {
    mediaType = "carousel";
    for (const c of cards.slice(0, MAX_CARDS)) {
      const u = str(c?.original_image_url) ?? str(c?.resized_image_url);
      if (u) carouselImageUrls.push(u);
    }
    thumbnailUrl = carouselImageUrls[0];
  } else if (cards.length === 1) {
    mediaType = "image";
    thumbnailUrl = str(cards[0]?.original_image_url) ?? str(cards[0]?.resized_image_url);
  } else if (images.length) {
    mediaType = "image";
    thumbnailUrl = str(images[0]?.original_image_url) ?? str(images[0]?.resized_image_url);
  }

  const linkUrl = str(snap?.link_url) ?? str(cards[0]?.link_url);
  const platformsRaw: string[] = Array.isArray(raw?.publisher_platforms)
    ? raw.publisher_platforms
    : Array.isArray(snap?.publisher_platforms)
    ? snap.publisher_platforms
    : [];
  const publisherPlatforms = platformsRaw.map((p) => String(p).toUpperCase());
  const platformsDisplay = publisherPlatforms.length
    ? publisherPlatforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ")
    : undefined;

  return {
    adArchiveId,
    pageId: str(raw?.pageID) ?? str(snap?.page_id) ?? str(raw?.page_id),
    pageName: str(snap?.page_name) ?? str(raw?.pageName),
    adText: str(snap?.body?.text) ?? str(raw?.adText),
    headline: str(snap?.title) ?? str(cards[0]?.title) ?? str(snap?.link_description),
    ctaText: str(snap?.cta_text) ?? str(cards[0]?.cta_text),
    linkUrl,
    displayDomain: str(snap?.caption) ?? domainFrom(linkUrl),
    mediaType,
    thumbnailUrl,
    videoUrl,
    carouselImageUrls,
    adLibraryUrl: str(raw?.url),
    startDate: toDate(raw?.startDate ?? raw?.start_date ?? snap?.start_date),
    metaSortRank: index,
    isDco: !!(raw?.is_dco ?? snap?.is_dco ?? raw?.isDco),
    collationId: str(raw?.collationID ?? raw?.collation_id ?? snap?.collation_id),
    adGroupId: str(raw?.adGroupID ?? raw?.ad_group_id ?? snap?.ad_group_id),
    publisherPlatforms,
    platformsDisplay,
  };
}

async function setStatus(jobId: string, status: string) {
  await db.update(schema.scrapeJobs).set({ status, updatedAt: new Date() }).where(eq(schema.scrapeJobs.id, jobId));
}
async function fail(jobId: string, message: string) {
  await db.update(schema.scrapeJobs).set({ status: "error", errorMessage: message, updatedAt: new Date() }).where(eq(schema.scrapeJobs.id, jobId));
}

async function storeMedia(brandSlug: string, adArchiveId: string, name: string, url: string, maxBytes: number): Promise<string | null> {
  const media = await fetchExternalMedia(url, { maxBytes });
  if (!media) return null;
  const path = storagePath(brandSlug, "scraped-meta-ads", `${adArchiveId}-${name}.${extFromContentType(media.contentType)}`);
  await uploadToStorage(path, media.buffer, media.contentType);
  return path;
}

async function ingestOne(job: Job, brandSlug: string, ad: NormalizedAd, isExisting: boolean): Promise<void> {
  if (isExisting) {
    await db
      .update(schema.competitorAds)
      .set({ dedupCount: sql`${schema.competitorAds.dedupCount} + 1`, scrapeJobId: job.id, updatedAt: new Date() })
      .where(and(eq(schema.competitorAds.brandId, job.brandId), eq(schema.competitorAds.adArchiveId, ad.adArchiveId)));
    return;
  }

  // poster (always, small)
  const thumbPath = ad.thumbnailUrl ? await storeMedia(brandSlug, ad.adArchiveId, "thumb", ad.thumbnailUrl, 25 * 1024 * 1024).catch(() => null) : null;

  // full video (best-effort)
  let videoPath: string | null = null;
  if (ad.mediaType === "video" && ad.videoUrl) {
    videoPath = await storeMedia(brandSlug, ad.adArchiveId, "video", ad.videoUrl, 200 * 1024 * 1024).catch(() => null);
  }

  // carousel frames (best-effort)
  const mediaCards: string[] = [];
  if (ad.mediaType === "carousel") {
    for (let i = 0; i < ad.carouselImageUrls.length; i++) {
      const p = await storeMedia(brandSlug, ad.adArchiveId, `card${i}`, ad.carouselImageUrls[i], 25 * 1024 * 1024).catch(() => null);
      if (p) mediaCards.push(p);
    }
  }

  await db
    .insert(schema.competitorAds)
    .values({
      brandId: job.brandId,
      scrapeJobId: job.id,
      adArchiveId: ad.adArchiveId,
      adGroupId: ad.adGroupId ?? null,
      collationId: ad.collationId ?? null,
      competitorPageId: ad.pageId ?? null,
      brandPageName: ad.pageName ?? null,
      snapshotDate: new Date(),
      adStartDate: ad.startDate ?? null,
      metaSortRank: ad.metaSortRank,
      isDco: ad.isDco,
      mediaType: ad.mediaType,
      primaryThumbnail: thumbPath,
      videoPath,
      mediaCards,
      fullMediaAsset: videoPath ?? thumbPath,
      platformsDisplay: ad.platformsDisplay ?? null,
      displayPrimaryText: ad.adText ?? null,
      headlineTitle: ad.headline ?? null,
      ctaButtonType: ad.ctaText ?? null,
      destinationUrl: ad.linkUrl ?? null,
      displayDomain: ad.displayDomain ?? null,
      adLibraryUrl: ad.adLibraryUrl ?? null,
      publisherPlatforms: ad.publisherPlatforms,
      aiAnalysisStatus: "queued",
    })
    .onConflictDoNothing();
}

/** Poll one job's Apify run; ingest a bounded batch of ads per pass. */
export async function pollAndIngestJob(job: Job): Promise<void> {
  if (!job.apifyRunId) return fail(job.id, "missing apify run id");

  const run = await getApifyRun(job.apifyRunId);

  if (run.status === "RUNNING" || run.status === "READY") {
    if (job.status === "pending") await setStatus(job.id, "running");
    return;
  }
  if (["FAILED", "ABORTED", "TIMED-OUT", "TIMED_OUT"].includes(run.status)) {
    return fail(job.id, `Apify run ${run.status}`);
  }
  if (run.status !== "SUCCEEDED") return;

  if (job.status !== "ingesting") await setStatus(job.id, "ingesting");

  const datasetId = run.datasetId ?? job.apifyDatasetId ?? undefined;
  if (!datasetId) return fail(job.id, "no dataset on run");

  const [brand] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, job.brandId)).limit(1);
  const brandSlug = brand?.slug ?? job.brandId;

  const items = await listApifyDataset<Record<string, any>>(datasetId, job.requestedCount + 10);
  const normalized = items
    .map((raw, i) => normalizeMetaAd(raw, i))
    .filter((n): n is NormalizedAd => !!n);

  const archiveIds = normalized.map((n) => n.adArchiveId);
  const existing = archiveIds.length
    ? await db
        .select({ adArchiveId: schema.competitorAds.adArchiveId, scrapeJobId: schema.competitorAds.scrapeJobId })
        .from(schema.competitorAds)
        .where(and(eq(schema.competitorAds.brandId, job.brandId), inArray(schema.competitorAds.adArchiveId, archiveIds)))
    : [];
  const byArchive = new Map(existing.map((e) => [e.adArchiveId, e.scrapeJobId]));

  const remaining = normalized.filter((n) => byArchive.get(n.adArchiveId) !== job.id);
  const batch = remaining.slice(0, PER_PASS);

  for (const ad of batch) {
    try {
      await ingestOne(job, brandSlug, ad, byArchive.has(ad.adArchiveId));
    } catch (e) {
      console.warn("[ingest] ad failed", ad.adArchiveId, e);
    }
  }

  const done = remaining.length - batch.length <= 0;
  if (done) {
    await recordApifyUsage({ runId: job.apifyRunId, usageUsd: run.usageUsd, systemKey: SYSTEM_KEY, brandId: job.brandId });
    await db
      .update(schema.scrapeJobs)
      .set({ status: "analyzing", apifyDatasetId: datasetId, stats: { adsFound: normalized.length }, costUsd: run.usageUsd.toFixed(6), updatedAt: new Date() })
      .where(eq(schema.scrapeJobs.id, job.id));
  } else {
    await db.update(schema.scrapeJobs).set({ apifyDatasetId: datasetId, updatedAt: new Date() }).where(eq(schema.scrapeJobs.id, job.id));
  }
}

export { SYSTEM_KEY };
