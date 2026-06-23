import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { startApifyRun } from "@/lib/providers/apify";
import { resolveScrapeUrl, isAdLibraryUrl, META_ADS_ACTOR_ID, type ScrapeMode } from "./meta-url";

export type StartScrapeOpts = {
  brandId: string;
  mode: ScrapeMode; // url | page_id | keyword
  query: string; // the Ad Library URL, page id, or keyword (also the job label)
  country?: string;
  requestedCount?: number;
  competitorId?: string | null;
  niche?: string | null;
};

/**
 * Start one Meta Ad Library scrape: resolve the URL, fire the Apify actor, insert
 * the scrape_jobs row. Shared by the manual scrape route and competitor discovery
 * so both go through one code path. Throws on a bad URL or an Apify start failure.
 */
export async function startScrapeJob(opts: StartScrapeOpts): Promise<{ jobId: string }> {
  const country = (opts.country || "ALL").trim();
  const requestedCount = Math.min(100, Math.max(1, opts.requestedCount || 20));
  const query = opts.query.trim();
  if (opts.mode === "url" && !isAdLibraryUrl(query)) {
    throw new Error("Paste a valid Meta Ad Library URL (facebook.com/ads/library/…)");
  }
  const url = resolveScrapeUrl({ mode: opts.mode, query, country });

  const run = await startApifyRun(META_ADS_ACTOR_ID, {
    count: requestedCount,
    scrapeAdDetails: true,
    urls: [{ url }],
    "scrapePageAds.activeStatus": "active",
    "scrapePageAds.countryCode": country,
  });

  const [job] = await db
    .insert(schema.scrapeJobs)
    .values({
      brandId: opts.brandId,
      competitorId: opts.competitorId ?? null,
      platform: "meta",
      mode: opts.mode,
      query,
      country,
      requestedCount,
      niche: opts.niche ?? null,
      status: "pending",
      apifyRunId: run.runId,
      apifyDatasetId: run.datasetId ?? null,
    })
    .returning({ id: schema.scrapeJobs.id });

  if (opts.competitorId) {
    await db.update(schema.competitors).set({ lastScrapedAt: new Date() }).where(eq(schema.competitors.id, opts.competitorId));
  }
  return { jobId: job.id };
}
