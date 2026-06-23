import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { clusterRun } from "./cluster";
import { computeConceptScore, assignTier, confidence, type Signals } from "./scoring";

type Job = typeof schema.scrapeJobs.$inferSelect;
type AdRow = typeof schema.competitorAds.$inferSelect;

const DAY = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.max(0, Math.round((a.getTime() - b.getTime()) / DAY));

/** Score every concept touched by one finished job, then mark it complete. */
async function scoreJob(job: Job): Promise<number> {
  const concepts = await clusterRun(job);
  const now = new Date();

  // Load representative ads in one batch for Angle Bank inheritance.
  const repIds = concepts.map((c) => c.representativeAdId).filter((id): id is string => !!id);
  const repRows = repIds.length
    ? await db.select().from(schema.competitorAds).where(inArray(schema.competitorAds.id, repIds))
    : [];
  const repById = new Map<string, AdRow>(repRows.map((r) => [r.id, r]));

  for (const c of concepts) {
    const prevEntry = [...c.prevCountHistory].reverse().find((e) => e.runId !== job.id);
    const variantDeltaWoW = prevEntry ? c.activeVariantCount - prevEntry.activeVariantCount : 0;

    const signals: Signals = {
      activeDays: c.activeDays,
      activeVariantCount: c.activeVariantCount,
      variantDeltaWoW,
      distinctFormats: c.distinctFormats,
      euReachPerDay: null, // v1: no EU reach
      resurrected: c.resurrected,
      daysSinceLastActive: c.stillActive ? 0 : c.lastSeenActive ? daysBetween(now, c.lastSeenActive) : 999,
      stillActive: c.stillActive,
      peakActiveDays: c.peakActiveDays,
    };

    const { score } = computeConceptScore(signals);
    const tier = assignTier(signals, score);
    const conf = confidence(signals);

    // count_history: replace this run's entry if present, else append (idempotent).
    const history = [...c.prevCountHistory];
    const entry = { runId: job.id, at: now.toISOString(), activeVariantCount: c.activeVariantCount, activeAdIds: c.activeAdIds, score };
    const lastIdx = history.length - 1;
    if (lastIdx >= 0 && history[lastIdx].runId === job.id) history[lastIdx] = entry;
    else history.push(entry);

    await db
      .update(schema.conceptClusters)
      .set({
        winnerScore: score,
        winnerTier: tier,
        confidence: conf,
        peakActiveDays: c.peakActiveDays,
        countHistory: history,
        lastScoredRunId: job.id,
        updatedAt: now,
      })
      .where(eq(schema.conceptClusters.id, c.conceptId));

    // ── upsert the Angle Bank entry (inherit the representative ad's teardown) ──
    const rep = c.representativeAdId ? repById.get(c.representativeAdId) : undefined;
    const teardown = {
      brandId: job.brandId,
      conceptId: c.conceptId,
      representativeAdId: c.representativeAdId,
      advertiser: c.advertiser,
      firstSeen: c.firstSeen,
      lastSeenActive: c.lastSeenActive,
      stillActive: c.stillActive,
      format: rep?.mediaType ?? null,
      platforms: rep?.publisherPlatforms ?? [],
      offer: rep?.outroOffer ?? null,
      angle: rep?.creativeAngle ?? null,
      hook: rep?.spokenHook || rep?.visualHook || null,
      mechanism: rep?.proofMechanism ?? null,
      awarenessLevel: rep?.awarenessLevel ?? null,
      emotionalDriver: rep?.emotionalDriver ?? null,
      secondaryDrivers: rep?.secondaryDrivers ?? [],
      beatStructure: rep?.beatStructure ?? [],
      visualNotes: rep?.visualNotes ?? rep?.geminiDescription ?? null,
      nativeScore: rep?.nativeScore ?? null,
      complianceFlags: rep?.complianceFlags ?? [],
      winnerScore: score,
      winnerTier: tier,
      signals: {
        activeDays: c.activeDays,
        activeVariants: c.activeVariantCount,
        euTotalReach: null,
        euReachPerDay: null,
        relaunched: c.resurrected,
        formats: c.formats,
      },
      confidence: conf,
      updatedAt: now,
    };

    await db
      .insert(schema.angleBankEntries)
      .values(teardown)
      .onConflictDoUpdate({
        target: schema.angleBankEntries.conceptId,
        // NB: status + usedInGenerations are intentionally NOT in `set` so an
        // approved curation (and its generation links) is never clobbered.
        set: teardown,
      });
  }

  await db
    .update(schema.scrapeJobs)
    .set({ status: "complete", stats: { ...(job.stats ?? {}), conceptsScored: concepts.length }, updatedAt: now })
    .where(eq(schema.scrapeJobs.id, job.id));

  return concepts.length;
}

/**
 * Advance jobs in the 'scoring' stage → cluster + score + Angle Bank → 'complete'.
 * brandId scopes the UI tick; the cron leaves it global. Idempotent throughout
 * (concept upsert by unique key, recomputed aggregates, run-guarded history).
 */
export async function scoreAnalyzedJobs(brandId?: string): Promise<number> {
  const jobs = await db
    .select()
    .from(schema.scrapeJobs)
    .where(and(eq(schema.scrapeJobs.status, "scoring"), ...(brandId ? [eq(schema.scrapeJobs.brandId, brandId)] : [])));

  let scored = 0;
  for (const job of jobs) {
    try {
      scored += await scoreJob(job);
    } catch (e) {
      console.warn("[scoring] job failed", job.id, e);
      // Don't strand the job in 'scoring' forever — let the sweep handle the timeout,
      // but on a hard error mark it complete so the board still shows the analyzed ads.
      await db
        .update(schema.scrapeJobs)
        .set({ status: "complete", errorMessage: `scoring failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`, updatedAt: new Date() })
        .where(eq(schema.scrapeJobs.id, job.id));
    }
  }
  return scored;
}
