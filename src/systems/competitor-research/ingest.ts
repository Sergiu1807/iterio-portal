import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getApifyRun, listApifyDataset, recordApifyUsage } from "@/lib/providers/apify";
import { fetchExternalMedia, uploadToStorage, storagePath, extFromContentType } from "@/lib/storage";

const PER_PASS = 12; // bound work per cron invocation
export const SYSTEM_KEY = "competitor-research";

type Job = typeof schema.scrapeJobs.$inferSelect;

type NormalizedAd = {
  adArchiveId: string;
  pageId?: string;
  pageName?: string;
  adText?: string;
  ctaText?: string;
  linkUrl?: string;
  displayDomain?: string;
  mediaType: "video" | "image" | "carousel" | "text";
  thumbnailUrl?: string;
  videoUrl?: string;
  adLibraryUrl?: string;
  startDate?: Date;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

function toDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return new Date(n < 1e12 ? n * 1000 : n);
  const d = new Date(v as string);
  return isNaN(+d) ? undefined : d;
}

export function normalizeMetaAd(raw: Record<string, any>): NormalizedAd | null {
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

  if (videos.length) {
    mediaType = "video";
    videoUrl = str(videos[0]?.video_hd_url) ?? str(videos[0]?.video_sd_url);
    thumbnailUrl = str(videos[0]?.video_preview_image_url) ?? str(images[0]?.original_image_url) ?? str(cards[0]?.original_image_url);
  } else if (cards.length) {
    mediaType = "carousel";
    thumbnailUrl = str(cards[0]?.original_image_url) ?? str(cards[0]?.resized_image_url);
  } else if (images.length) {
    mediaType = "image";
    thumbnailUrl = str(images[0]?.original_image_url) ?? str(images[0]?.resized_image_url);
  }

  return {
    adArchiveId,
    pageId: str(raw?.pageID) ?? str(snap?.page_id) ?? str(raw?.page_id),
    pageName: str(snap?.page_name) ?? str(raw?.pageName),
    adText: str(snap?.body?.text) ?? str(raw?.adText),
    ctaText: str(snap?.cta_text),
    linkUrl: str(snap?.link_url),
    displayDomain: str(snap?.caption) ?? str(snap?.link_description),
    mediaType,
    thumbnailUrl,
    videoUrl,
    adLibraryUrl: str(raw?.url),
    startDate: toDate(raw?.startDate ?? raw?.start_date ?? snap?.start_date),
  };
}

async function setStatus(jobId: string, status: string) {
  await db.update(schema.scrapeJobs).set({ status, updatedAt: new Date() }).where(eq(schema.scrapeJobs.id, jobId));
}
async function fail(jobId: string, message: string) {
  await db.update(schema.scrapeJobs).set({ status: "error", errorMessage: message, updatedAt: new Date() }).where(eq(schema.scrapeJobs.id, jobId));
}

async function ingestOne(job: Job, brandSlug: string, ad: NormalizedAd, isExisting: boolean): Promise<void> {
  if (isExisting) {
    // cross-run duplicate → bump dedup_count once and re-tag to this job
    await db
      .update(schema.competitorAds)
      .set({ dedupCount: sql`${schema.competitorAds.dedupCount} + 1`, scrapeJobId: job.id, updatedAt: new Date() })
      .where(and(eq(schema.competitorAds.brandId, job.brandId), eq(schema.competitorAds.adArchiveId, ad.adArchiveId)));
    return;
  }

  let thumbPath: string | null = null;
  if (ad.thumbnailUrl) {
    const media = await fetchExternalMedia(ad.thumbnailUrl, { maxBytes: 25 * 1024 * 1024 });
    if (media) {
      thumbPath = storagePath(brandSlug, "scraped-meta-ads", `${ad.adArchiveId}-thumb.${extFromContentType(media.contentType)}`);
      await uploadToStorage(thumbPath, media.buffer, media.contentType);
    }
  }

  await db
    .insert(schema.competitorAds)
    .values({
      brandId: job.brandId,
      scrapeJobId: job.id,
      adArchiveId: ad.adArchiveId,
      competitorPageId: ad.pageId ?? null,
      brandPageName: ad.pageName ?? null,
      mediaType: ad.mediaType,
      primaryThumbnail: thumbPath,
      fullMediaAsset: thumbPath, // pilot: own the poster; deep video capture is a follow-up
      displayPrimaryText: ad.adText ?? null,
      ctaButtonType: ad.ctaText ?? null,
      destinationUrl: ad.linkUrl ?? null,
      displayDomain: ad.displayDomain ?? null,
      adLibraryUrl: ad.adLibraryUrl ?? null,
      adStartDate: ad.startDate ?? null,
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
  if (run.status !== "SUCCEEDED") return; // unknown state — wait for next pass

  if (job.status !== "ingesting") await setStatus(job.id, "ingesting");

  const datasetId = run.datasetId ?? job.apifyDatasetId ?? undefined;
  if (!datasetId) return fail(job.id, "no dataset on run");

  const [brand] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, job.brandId)).limit(1);
  const brandSlug = brand?.slug ?? job.brandId;

  const items = await listApifyDataset<Record<string, any>>(datasetId, job.requestedCount + 10);
  const normalized = items.map(normalizeMetaAd).filter((n): n is NormalizedAd => !!n);

  const archiveIds = normalized.map((n) => n.adArchiveId);
  const existing = archiveIds.length
    ? await db
        .select({ adArchiveId: schema.competitorAds.adArchiveId, scrapeJobId: schema.competitorAds.scrapeJobId })
        .from(schema.competitorAds)
        .where(and(eq(schema.competitorAds.brandId, job.brandId), inArray(schema.competitorAds.adArchiveId, archiveIds)))
    : [];
  const byArchive = new Map(existing.map((e) => [e.adArchiveId, e.scrapeJobId]));

  // not yet associated with THIS job
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
