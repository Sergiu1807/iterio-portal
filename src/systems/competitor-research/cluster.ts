import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";

type AdRow = typeof schema.competitorAds.$inferSelect;
type Job = typeof schema.scrapeJobs.$inferSelect;

const DAY = 86_400_000;

// ── concept key ────────────────────────────────────────────────────────────
// Meta already groups variants of one creative concept under collation_id; use
// that first, then ad_group_id, then a stable hash of the normalized primary text.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function normalizeText(t: string | null | undefined): string {
  return (t ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function conceptKey(ad: AdRow): { key: string; method: "collation" | "ad_group" | "text_hash" } {
  if (ad.collationId) return { key: `collation:${ad.collationId}`, method: "collation" };
  if (ad.adGroupId) return { key: `adgroup:${ad.adGroupId}`, method: "ad_group" };
  const norm = normalizeText(ad.displayPrimaryText) || normalizeText(ad.headlineTitle) || ad.adArchiveId;
  return { key: `texthash:${fnv1a(norm)}`, method: "text_hash" };
}

const daysBetween = (a: Date, b: Date) => Math.max(0, Math.round((a.getTime() - b.getTime()) / DAY));

/** What scoring-run needs per touched concept to compute the score + Angle Bank. */
export type ClusteredConcept = {
  conceptId: string;
  conceptKey: string;
  activeVariantCount: number;
  totalVariantCount: number;
  distinctFormats: number;
  formats: string[];
  activeDays: number;
  peakActiveDays: number;
  stillActive: boolean;
  resurrected: boolean;
  firstSeen: Date | null;
  lastSeenActive: Date | null;
  representativeAdId: string | null;
  activeAdIds: string[];
  advertiser: string | null;
  prevCountHistory: { runId: string; at: string; activeVariantCount: number; activeAdIds: string[]; score: number }[];
  lastScoredRunId: string | null;
};

/**
 * Recompute every concept touched by this run from the FULL ad set of the
 * competitor page(s) involved — fully idempotent (recompute-from-state, never
 * increment). Upserts concept_clusters, links member ads' conceptId, and returns
 * the aggregated signals for scoring-run to score.
 */
export async function clusterRun(job: Job): Promise<ClusteredConcept[]> {
  // Ads seen in THIS run carry scrapeJobId = job.id (ingest sets it on insert + dedup).
  const runAds = await db
    .select()
    .from(schema.competitorAds)
    .where(and(eq(schema.competitorAds.brandId, job.brandId), eq(schema.competitorAds.scrapeJobId, job.id)));
  if (!runAds.length) return [];

  // Aggregate concepts across the full ad set of each page the run touched (across
  // all runs), so the variant count reflects everything we've ever harvested.
  const pageIds = Array.from(new Set(runAds.map((a) => a.competitorPageId ?? "__nopage__")));
  const realPageIds = pageIds.filter((p) => p !== "__nopage__");

  const pageAds = realPageIds.length
    ? await db
        .select()
        .from(schema.competitorAds)
        .where(and(eq(schema.competitorAds.brandId, job.brandId), inArray(schema.competitorAds.competitorPageId, realPageIds)))
    : [];
  // Ads with no page id: aggregate them on their own (per the run only).
  const nopageAds = pageIds.includes("__nopage__") ? runAds.filter((a) => !a.competitorPageId) : [];
  const allAds = [...pageAds, ...nopageAds];

  // group by conceptKey
  const groups = new Map<string, { method: "collation" | "ad_group" | "text_hash"; ads: AdRow[] }>();
  for (const ad of allAds) {
    const { key, method } = conceptKey(ad);
    const g = groups.get(key) ?? { method, ads: [] };
    g.ads.push(ad);
    groups.set(key, g);
  }

  const out: ClusteredConcept[] = [];
  const now = new Date();

  for (const [key, g] of groups) {
    const ads = g.ads;
    const activeAds = ads.filter((a) => a.stillActive !== false); // treat null/true as active (v1)
    const formats = Array.from(new Set(ads.map((a) => a.mediaType).filter((m): m is string => !!m)));
    const firstSeenCandidates = ads
      .map((a) => a.firstSeenActive ?? a.adStartDate ?? a.snapshotDate)
      .filter((d): d is Date => !!d);
    const lastSeenCandidates = ads.map((a) => a.lastSeenActive ?? a.snapshotDate).filter((d): d is Date => !!d);
    const firstSeen = firstSeenCandidates.length ? new Date(Math.min(...firstSeenCandidates.map((d) => +d))) : null;
    const lastSeenActive = lastSeenCandidates.length ? new Date(Math.max(...lastSeenCandidates.map((d) => +d))) : null;
    const activeDays = firstSeen && lastSeenActive ? daysBetween(lastSeenActive, firstSeen) : 0;
    const stillActive = activeAds.length > 0;
    const resurrected = ads.some((a) => a.resurrected);
    // representative = newest-enriched ad (most recent analysis), else newest snapshot
    const enriched = ads
      .filter((a) => a.aiAnalysisStatus === "complete")
      .sort((a, b) => +(b.aiLastAnalyzedAt ?? b.createdAt) - +(a.aiLastAnalyzedAt ?? a.createdAt));
    const representative = enriched[0] ?? ads.slice().sort((a, b) => +(b.snapshotDate ?? b.createdAt) - +(a.snapshotDate ?? a.createdAt))[0] ?? null;
    const advertiser = ads.find((a) => a.brandPageName)?.brandPageName ?? null;
    const competitorId = job.competitorId ?? null;

    // Upsert concept identity + static aggregates. Dynamic score fields + count_history
    // are written by scoring-run. peakActiveDays uses GREATEST against the stored value.
    const [row] = await db
      .insert(schema.conceptClusters)
      .values({
        brandId: job.brandId,
        competitorId,
        conceptKey: key,
        clusterMethod: g.method,
        advertiser,
        representativeAdId: representative?.id ?? null,
        activeVariantCount: activeAds.length,
        totalVariantCount: ads.length,
        distinctFormats: formats.length,
        formats,
        firstSeen,
        lastSeenActive,
        activeDays,
        peakActiveDays: activeDays,
        stillActive,
        resurrected,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.conceptClusters.brandId, schema.conceptClusters.conceptKey],
        set: {
          competitorId,
          clusterMethod: g.method,
          advertiser,
          representativeAdId: representative?.id ?? null,
          activeVariantCount: activeAds.length,
          totalVariantCount: ads.length,
          distinctFormats: formats.length,
          formats,
          firstSeen,
          lastSeenActive,
          activeDays,
          stillActive,
          resurrected,
          updatedAt: now,
        },
      })
      .returning({
        id: schema.conceptClusters.id,
        peakActiveDays: schema.conceptClusters.peakActiveDays,
        countHistory: schema.conceptClusters.countHistory,
        lastScoredRunId: schema.conceptClusters.lastScoredRunId,
      });

    const peakActiveDays = Math.max(activeDays, row.peakActiveDays ?? 0);

    // link member ads to this concept
    await db
      .update(schema.competitorAds)
      .set({ conceptId: row.id })
      .where(inArray(schema.competitorAds.id, ads.map((a) => a.id)));

    out.push({
      conceptId: row.id,
      conceptKey: key,
      activeVariantCount: activeAds.length,
      totalVariantCount: ads.length,
      distinctFormats: formats.length,
      formats,
      activeDays,
      peakActiveDays,
      stillActive,
      resurrected,
      firstSeen,
      lastSeenActive,
      representativeAdId: representative?.id ?? null,
      activeAdIds: activeAds.map((a) => a.id),
      advertiser,
      prevCountHistory: row.countHistory ?? [],
      lastScoredRunId: row.lastScoredRunId ?? null,
    });
  }

  return out;
}
