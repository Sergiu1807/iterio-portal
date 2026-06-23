import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { assertCron } from "@/lib/cron";
import { startScrapeJob } from "@/systems/competitor-research/scrape-job";
import { isAdLibraryUrl } from "@/systems/competitor-research/meta-url";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RADAR_COUNT = 40; // generous so a still-running ad isn't dropped from the tail
const STALE_DAYS = 21; // not seen in 3 weeks of radar → treat as inactive
const MAX_PER_RUN = 50; // backstop against a runaway fan-out

/**
 * Weekly radar: (1) age out ads not seen in STALE_DAYS → inactive (so recency
 * decay + the Historical tier reflect reality), then (2) re-scrape every pinned
 * competitor. Their new scrape jobs flow through the existing pipeline, which
 * refreshes still-running ads, re-clusters, and appends a fresh count_history
 * snapshot → that's what powers WoW momentum + the Scaling-now tier.
 */
export async function GET(req: Request) {
  const denied = assertCron(req);
  if (denied) return denied;

  // 1. age out stale ads (only flips active → inactive; harmless + idempotent)
  const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000);
  const aged = await db
    .update(schema.competitorAds)
    .set({ stillActive: false, updatedAt: new Date() })
    .where(and(eq(schema.competitorAds.stillActive, true), lt(schema.competitorAds.lastSeenActive, cutoff)))
    .returning({ id: schema.competitorAds.id });

  // 2. re-scrape pinned competitors
  const pinned = await db
    .select()
    .from(schema.competitors)
    .where(and(eq(schema.competitors.radarEnabled, true), eq(schema.competitors.isActive, true)))
    .limit(MAX_PER_RUN);

  let rescraped = 0;
  for (const c of pinned) {
    try {
      if (c.metaLibraryUrl && isAdLibraryUrl(c.metaLibraryUrl)) {
        await startScrapeJob({ brandId: c.brandId, mode: "url", query: c.metaLibraryUrl, country: c.country, requestedCount: RADAR_COUNT, competitorId: c.id, niche: c.niche });
      } else if (c.metaPageId) {
        await startScrapeJob({ brandId: c.brandId, mode: "page_id", query: c.metaPageId, country: c.country, requestedCount: RADAR_COUNT, competitorId: c.id, niche: c.niche });
      } else {
        await startScrapeJob({ brandId: c.brandId, mode: "keyword", query: c.name, country: c.country, requestedCount: RADAR_COUNT, competitorId: c.id, niche: c.niche });
      }
      rescraped++;
    } catch (e) {
      console.warn("[radar] re-scrape failed", c.id, String(e).slice(0, 120));
    }
  }

  return NextResponse.json({ agedOut: aged.length, rescraped, pinned: pinned.length });
}
