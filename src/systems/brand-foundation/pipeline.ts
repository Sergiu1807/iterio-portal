import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { startScrapeJob } from "@/systems/competitor-research/scrape-job";
import { isAdLibraryUrl } from "@/systems/competitor-research/meta-url";
import { runWebsiteJob } from "./modules/website";
import { synthesizeB3 } from "./synthesis";

const MAX_ATTEMPTS = 3;
const TERMINAL_SOURCE = ["complete", "failed", "partial"];
// Source types with a live P2 module; others are deferred (P3) and marked "partial".
const P2_TYPES = ["website", "meta_ads", "competitor"];

type SourceRow = typeof schema.brandSources.$inferSelect;
type JobRow = typeof schema.researchJobs.$inferSelect;

function isTransient(e: unknown): boolean {
  if (e instanceof Anthropic.APIError) { const s = e.status ?? 0; return s === 429 || s >= 500; }
  return /connection error|fetch failed|econnreset|etimedout|socket|network|timed out/i.test(String((e as { message?: string })?.message ?? e));
}

const setSource = (id: string, patch: Partial<SourceRow>) => db.update(schema.brandSources).set({ ...patch, updatedAt: new Date() }).where(eq(schema.brandSources.id, id));
const setJob = (id: string, patch: Partial<JobRow>) => db.update(schema.researchJobs).set({ ...patch, updatedAt: new Date() }).where(eq(schema.researchJobs.id, id));

/** Create jobs for every enabled source + fan out the delegated (meta/competitor) scrapes. */
export async function startOnboarding(brandId: string): Promise<void> {
  const sources = await db.select().from(schema.brandSources).where(and(eq(schema.brandSources.brandId, brandId), eq(schema.brandSources.enabled, true)));

  for (const s of sources) {
    if (!P2_TYPES.includes(s.type)) {
      await setSource(s.id, { status: "partial", lastError: "Module arrives in a later build" });
      continue;
    }
    // clear any prior jobs for this source (re-run safe)
    await db.delete(schema.researchJobs).where(eq(schema.researchJobs.sourceId, s.id));

    if (s.type === "website") {
      await setSource(s.id, { status: "running", lastRunAt: new Date(), lastError: null });
      await db.insert(schema.researchJobs).values({ brandId, sourceId: s.id, module: "website", type: "extract", status: "pending", provider: "claude" });
      continue;
    }

    // meta_ads / competitor → delegate to the existing competitor pipeline
    try {
      let scrapeJobId: string;
      if (s.type === "competitor") {
        const name = String(s.config?.name ?? s.handle ?? "Competitor");
        const metaLib = String(s.config?.metaLibraryUrl ?? "");
        const [comp] = await db
          .insert(schema.competitors)
          .values({ brandId, name, websiteUrl: s.url ?? null, metaLibraryUrl: metaLib || null, type: "Direct", country: "ALL" })
          .returning({ id: schema.competitors.id });
        const useUrl = metaLib && isAdLibraryUrl(metaLib);
        ({ jobId: scrapeJobId } = await startScrapeJob(useUrl ? { brandId, mode: "url", query: metaLib, competitorId: comp.id } : { brandId, mode: "keyword", query: name, competitorId: comp.id }));
      } else {
        // brand's own Meta ads
        const url = s.url ?? "";
        ({ jobId: scrapeJobId } = await startScrapeJob(isAdLibraryUrl(url) ? { brandId, mode: "url", query: url } : { brandId, mode: "keyword", query: url }));
      }
      await setSource(s.id, { status: "running", lastRunAt: new Date(), lastError: null, config: { ...s.config, scrapeJobId } });
      await db.insert(schema.researchJobs).values({ brandId, sourceId: s.id, module: s.type, type: "delegated", status: "running", provider: "apify", meta: { scrapeJobId } });
    } catch (e) {
      await setSource(s.id, { status: "failed", lastError: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  }
}

/** Re-run a single source (reset + re-fan-out). */
export async function rerunSource(brandId: string, sourceId: string): Promise<void> {
  await setSource(sourceId, { status: "queued", lastError: null });
  // startOnboarding re-creates jobs for all enabled sources, but only re-fires the ones needing it;
  // to keep it scoped, just re-run this source by re-dispatching the whole set (idempotent for others
  // that are already complete? no) — so handle this one inline:
  const [s] = await db.select().from(schema.brandSources).where(eq(schema.brandSources.id, sourceId)).limit(1);
  if (!s) return;
  if (!P2_TYPES.includes(s.type)) { await setSource(s.id, { status: "partial" }); return; }
  await db.delete(schema.researchJobs).where(eq(schema.researchJobs.sourceId, s.id));
  if (s.type === "website") {
    await setSource(s.id, { status: "running", lastRunAt: new Date() });
    await db.insert(schema.researchJobs).values({ brandId, sourceId: s.id, module: "website", type: "extract", status: "pending", provider: "claude" });
  } else {
    try {
      const name = String(s.config?.name ?? s.handle ?? "Competitor");
      const metaLib = String(s.config?.metaLibraryUrl ?? "");
      let scrapeJobId: string;
      if (s.type === "competitor") {
        const useUrl = metaLib && isAdLibraryUrl(metaLib);
        ({ jobId: scrapeJobId } = await startScrapeJob(useUrl ? { brandId, mode: "url", query: metaLib } : { brandId, mode: "keyword", query: name }));
      } else {
        const url = s.url ?? "";
        ({ jobId: scrapeJobId } = await startScrapeJob(isAdLibraryUrl(url) ? { brandId, mode: "url", query: url } : { brandId, mode: "keyword", query: url }));
      }
      await setSource(s.id, { status: "running", lastRunAt: new Date(), config: { ...s.config, scrapeJobId } });
      await db.insert(schema.researchJobs).values({ brandId, sourceId: s.id, module: s.type, type: "delegated", status: "running", provider: "apify", meta: { scrapeJobId } });
    } catch (e) {
      await setSource(s.id, { status: "failed", lastError: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  }
}

/** Advance delegated (meta/competitor) jobs by checking the linked scrape_job. */
async function advanceDelegated(brandId?: string): Promise<void> {
  const jobs = await db
    .select()
    .from(schema.researchJobs)
    .where(and(eq(schema.researchJobs.type, "delegated"), eq(schema.researchJobs.status, "running"), ...(brandId ? [eq(schema.researchJobs.brandId, brandId)] : [])));
  for (const j of jobs) {
    const scrapeJobId = (j.meta as { scrapeJobId?: string })?.scrapeJobId;
    if (!scrapeJobId) { await setJob(j.id, { status: "failed", error: "no scrape job linked" }); if (j.sourceId) await setSource(j.sourceId, { status: "failed" }); continue; }
    const [sj] = await db.select({ status: schema.scrapeJobs.status, error: schema.scrapeJobs.errorMessage }).from(schema.scrapeJobs).where(eq(schema.scrapeJobs.id, scrapeJobId)).limit(1);
    if (!sj) continue;
    if (sj.status === "complete") { await setJob(j.id, { status: "complete" }); if (j.sourceId) await setSource(j.sourceId, { status: "complete" }); }
    else if (sj.status === "error") { await setJob(j.id, { status: "failed", error: sj.error ?? "scrape failed" }); if (j.sourceId) await setSource(j.sourceId, { status: "failed", lastError: sj.error ?? "scrape failed" }); }
    // else still running — leave
  }
}

/** Atomic-claim + run website extraction jobs (FOR UPDATE SKIP LOCKED). */
async function claimAndRunWebsite(brandId?: string, limit = 3): Promise<number> {
  const brandFilter = brandId ? sql`AND brand_id = ${brandId}` : sql``;
  const claimed = await db.execute(sql`
    UPDATE research_jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM research_jobs
      WHERE module = 'website' AND type = 'extract' AND status = 'pending' AND attempts < ${MAX_ATTEMPTS} ${brandFilter}
      ORDER BY created_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING id`);
  const ids = (claimed as unknown as { id: string }[]).map((r) => r.id);
  if (!ids.length) return 0;

  const jobs = await db.select().from(schema.researchJobs).where(inArray(schema.researchJobs.id, ids));
  for (const j of jobs) {
    const [source] = j.sourceId ? await db.select().from(schema.brandSources).where(eq(schema.brandSources.id, j.sourceId)).limit(1) : [];
    if (!source) { await setJob(j.id, { status: "failed", error: "source missing" }); continue; }
    try {
      await runWebsiteJob(j, source);
      await setJob(j.id, { status: "complete" });
      await setSource(source.id, { status: "complete", lastError: null });
    } catch (e) {
      if (isTransient(e)) {
        await setJob(j.id, { status: "pending", attempts: Math.max(0, j.attempts - 1), error: String(e).slice(0, 300) });
      } else {
        const exhausted = j.attempts >= MAX_ATTEMPTS;
        await setJob(j.id, { status: exhausted ? "failed" : "pending", error: String(e).slice(0, 300) });
        if (exhausted) await setSource(source.id, { status: "failed", lastError: String(e).slice(0, 300) });
      }
    }
  }
  return jobs.length;
}

/** Synthesize a B3 draft once a brand's sources have all settled (and re-synthesize on change). */
export async function maybeSynthesize(brandId: string): Promise<void> {
  const sources = await db.select().from(schema.brandSources).where(and(eq(schema.brandSources.brandId, brandId), eq(schema.brandSources.enabled, true)));
  if (!sources.length) return;
  if (!sources.every((s) => TERMINAL_SOURCE.includes(s.status))) return;
  const maxSourceUpdate = Math.max(...sources.map((s) => +new Date(s.updatedAt)));

  const [latest] = await db.select().from(schema.brandIntelligence).where(eq(schema.brandIntelligence.brandId, brandId)).orderBy(sql`version desc`).limit(1);
  const gen = (() => { const g = (latest?.json as { meta?: { generated_at?: string } } | undefined)?.meta?.generated_at; return g ? +new Date(g) : 0; })();
  if (latest && gen >= maxSourceUpdate) return; // already synthesized for the current source state

  await synthesizeB3(brandId);
}

/** UI-driven advance for one brand (mirrors the competitor tick). */
export async function runOnboardingTick(brandId: string): Promise<void> {
  await advanceDelegated(brandId);
  await claimAndRunWebsite(brandId, 2);
  await maybeSynthesize(brandId);
}

/** Cron backstops. */
export async function pollDelegatedAll(): Promise<void> { await advanceDelegated(); }
export async function extractAll(): Promise<void> {
  await claimAndRunWebsite(undefined, 4);
  // synthesize for any brand whose sources have all settled
  const brands = await db.selectDistinct({ brandId: schema.brandSources.brandId }).from(schema.brandSources);
  for (const b of brands) await maybeSynthesize(b.brandId);
}
export async function sweepStuck(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  await db.update(schema.researchJobs).set({ status: "failed", error: "Timed out (sweep)", updatedAt: new Date() }).where(and(inArray(schema.researchJobs.status, ["pending", "running"]), lt(schema.researchJobs.updatedAt, cutoff)));
  await db.update(schema.brandSources).set({ status: "failed", updatedAt: new Date() }).where(and(inArray(schema.brandSources.status, ["queued", "running"]), lt(schema.brandSources.updatedAt, cutoff)));
}
