import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { startScrapeJob } from "@/systems/competitor-research/scrape-job";
import { isAdLibraryUrl } from "@/systems/competitor-research/meta-url";
import { runWebsiteJob } from "./modules/website";
import { runReviewsJob } from "./modules/reviews";
import { runRedditJob } from "./modules/reddit";
import { runSocialJob } from "./modules/social";
import { runEmailJob } from "./modules/email";
import { runComplianceJob } from "./modules/compliance";
import { WaitError } from "./modules/wait-error";

const MAX_ATTEMPTS = 3;
const TERMINAL_SOURCE = ["complete", "failed", "partial"];
const REVIEW_TYPES = ["amazon", "trustpilot", "google_reviews"];
const DELEGATED_TYPES = ["meta_ads", "competitor"];
// Source type → the internal extract module that runs it.
const EXTRACT_MODULE: Record<string, string> = { website: "website", amazon: "reviews", trustpilot: "reviews", google_reviews: "reviews", reddit: "reddit", social: "social", email: "email" };
const MODULE_PROVIDER: Record<string, string> = { website: "claude", reviews: "apify", reddit: "apify", social: "apify", email: "claude" };
// User-input source types with a live module; others (upload) are deferred → "partial".
const LIVE_INPUT_TYPES = ["website", ...DELEGATED_TYPES, ...REVIEW_TYPES, "reddit", "social", "email"];

type SourceRow = typeof schema.brandSources.$inferSelect;
type JobRow = typeof schema.researchJobs.$inferSelect;

function isTransient(e: unknown): boolean {
  if (e instanceof Anthropic.APIError) { const s = e.status ?? 0; return s === 429 || s >= 500; }
  return /connection error|fetch failed|econnreset|etimedout|socket|network|timed out|gemini \d/i.test(String((e as { message?: string })?.message ?? e));
}

const setSource = (id: string, patch: Partial<SourceRow>) => db.update(schema.brandSources).set({ ...patch, updatedAt: new Date() }).where(eq(schema.brandSources.id, id));
const setJob = (id: string, patch: Partial<JobRow>) => db.update(schema.researchJobs).set({ ...patch, updatedAt: new Date() }).where(eq(schema.researchJobs.id, id));

const RUNNERS: Record<string, (job: JobRow, source: SourceRow) => Promise<void>> = {
  website: runWebsiteJob,
  reviews: runReviewsJob,
  reddit: runRedditJob,
  social: runSocialJob,
  email: runEmailJob,
  compliance: runComplianceJob,
};

/** Delegate a meta/competitor source to the existing competitor pipeline. */
async function delegateScrape(brandId: string, s: SourceRow): Promise<void> {
  let scrapeJobId: string;
  if (s.type === "competitor") {
    const name = String(s.config?.name ?? s.handle ?? "Competitor");
    const metaLib = String(s.config?.metaLibraryUrl ?? "");
    // reuse an existing competitor row for this brand+name (don't duplicate on re-run)
    const [ex] = await db.select({ id: schema.competitors.id }).from(schema.competitors).where(and(eq(schema.competitors.brandId, brandId), eq(schema.competitors.name, name))).limit(1);
    const competitorId = ex
      ? ex.id
      : (await db.insert(schema.competitors).values({ brandId, name, websiteUrl: s.url ?? null, metaLibraryUrl: metaLib || null, type: "Direct", country: "ALL" }).returning({ id: schema.competitors.id }))[0].id;
    const useUrl = metaLib && isAdLibraryUrl(metaLib);
    ({ jobId: scrapeJobId } = await startScrapeJob(useUrl ? { brandId, mode: "url", query: metaLib, competitorId } : { brandId, mode: "keyword", query: name, competitorId }));
  } else {
    const url = s.url ?? "";
    ({ jobId: scrapeJobId } = await startScrapeJob(isAdLibraryUrl(url) ? { brandId, mode: "url", query: url } : { brandId, mode: "keyword", query: url }));
  }
  await setSource(s.id, { status: "running", lastRunAt: new Date(), lastError: null, config: { ...s.config, scrapeJobId } });
  await db.insert(schema.researchJobs).values({ brandId, sourceId: s.id, module: s.type, type: "delegated", status: "running", provider: "apify", meta: { scrapeJobId } });
}

/** Create (once) the auto compliance source + its pending job. Depends on the website extraction. */
async function ensureComplianceJob(brandId: string): Promise<void> {
  let [src] = await db.select().from(schema.brandSources).where(and(eq(schema.brandSources.brandId, brandId), eq(schema.brandSources.type, "compliance"))).limit(1);
  if (!src) {
    [src] = await db.insert(schema.brandSources).values({ brandId, type: "compliance", status: "running", config: { auto: true } }).returning();
  } else {
    await setSource(src.id, { status: "running", lastError: null });
  }
  await db.delete(schema.researchJobs).where(eq(schema.researchJobs.sourceId, src.id));
  await db.insert(schema.researchJobs).values({ brandId, sourceId: src.id, module: "compliance", type: "extract", status: "pending", provider: "gemini" });
}

async function dispatchSource(brandId: string, s: SourceRow): Promise<void> {
  if (!LIVE_INPUT_TYPES.includes(s.type)) { await setSource(s.id, { status: "partial", lastError: "Module arrives in a later build" }); return; }
  await db.delete(schema.researchJobs).where(eq(schema.researchJobs.sourceId, s.id));
  if (DELEGATED_TYPES.includes(s.type)) {
    try { await delegateScrape(brandId, s); } catch (e) { await setSource(s.id, { status: "failed", lastError: String((e as Error)?.message ?? e).slice(0, 300) }); }
    return;
  }
  const mod = EXTRACT_MODULE[s.type];
  if (!mod) { await setSource(s.id, { status: "partial", lastError: "Module arrives in a later build" }); return; }
  await setSource(s.id, { status: "running", lastRunAt: new Date(), lastError: null });
  await db.insert(schema.researchJobs).values({ brandId, sourceId: s.id, module: mod, type: "extract", status: "pending", provider: MODULE_PROVIDER[mod] ?? "claude" });
}

/** Create jobs for every enabled source + fan out the delegated scrapes + auto compliance. */
export async function startOnboarding(brandId: string): Promise<void> {
  const sources = await db.select().from(schema.brandSources).where(and(eq(schema.brandSources.brandId, brandId), eq(schema.brandSources.enabled, true)));
  const inputSources = sources.filter((s) => s.type !== "compliance");
  for (const s of inputSources) await dispatchSource(brandId, s);
  if (inputSources.some((s) => s.type === "website")) await ensureComplianceJob(brandId);
}

/** Re-run a single source. */
export async function rerunSource(brandId: string, sourceId: string): Promise<void> {
  const [s] = await db.select().from(schema.brandSources).where(eq(schema.brandSources.id, sourceId)).limit(1);
  if (!s) return;
  if (s.type === "compliance") { await ensureComplianceJob(brandId); return; }
  await dispatchSource(brandId, s);
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
  }
}

/** Atomic-claim + run internal extract jobs (website / reviews / compliance). */
async function claimAndRunExtract(brandId?: string, limit = 3): Promise<number> {
  const brandFilter = brandId ? sql`AND brand_id = ${brandId}` : sql``;
  const claimed = await db.execute(sql`
    UPDATE research_jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM research_jobs
      WHERE module IN ('website','reviews','compliance','reddit','social','email') AND type = 'extract' AND status = 'pending' AND attempts < ${MAX_ATTEMPTS} ${brandFilter}
      ORDER BY created_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING id`);
  const ids = (claimed as unknown as { id: string }[]).map((r) => r.id);
  if (!ids.length) return 0;

  const jobs = await db.select().from(schema.researchJobs).where(inArray(schema.researchJobs.id, ids));
  for (const j of jobs) {
    const [source] = j.sourceId ? await db.select().from(schema.brandSources).where(eq(schema.brandSources.id, j.sourceId)).limit(1) : [];
    const runner = RUNNERS[j.module];
    if (!source || !runner) { await setJob(j.id, { status: "failed", error: "source/module missing" }); continue; }
    const t0 = new Date();
    try {
      await runner(j, source);
      // Attribute this runner's provider spend to the job (runners execute sequentially → clean window).
      const [{ c }] = await db
        .select({ c: sql<number>`coalesce(sum(${schema.usageEvents.costUsd}),0)`.mapWith(Number) })
        .from(schema.usageEvents)
        .where(and(eq(schema.usageEvents.systemKey, "brand-onboarding"), eq(schema.usageEvents.brandId, j.brandId), gte(schema.usageEvents.createdAt, t0)));
      await setJob(j.id, { status: "complete", costCents: Math.round((c ?? 0) * 100) });
      await setSource(source.id, { status: "complete", lastError: null });
    } catch (e) {
      if (e instanceof WaitError) {
        await setJob(j.id, { status: "pending", attempts: Math.max(0, j.attempts - 1) }); // dependency not ready — retry, no burn
      } else if (isTransient(e)) {
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

  const { synthesizeB3 } = await import("./synthesis");
  await synthesizeB3(brandId);
}

/** UI-driven advance for one brand (mirrors the competitor tick). */
export async function runOnboardingTick(brandId: string): Promise<void> {
  await advanceDelegated(brandId);
  await claimAndRunExtract(brandId, 2);
  await maybeSynthesize(brandId);
}

/** Cron backstops. */
export async function pollDelegatedAll(): Promise<void> { await advanceDelegated(); }
export async function extractAll(): Promise<void> {
  await claimAndRunExtract(undefined, 4);
  const brands = await db.selectDistinct({ brandId: schema.brandSources.brandId }).from(schema.brandSources);
  for (const b of brands) {
    try { await maybeSynthesize(b.brandId); } catch (e) { console.warn("[brand-foundation] synthesis failed", b.brandId, String(e).slice(0, 200)); }
  }
}
export async function sweepStuck(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  await db.update(schema.researchJobs).set({ status: "failed", error: "Timed out (sweep)", updatedAt: new Date() }).where(and(inArray(schema.researchJobs.status, ["pending", "running"]), lt(schema.researchJobs.updatedAt, cutoff)));
  await db.update(schema.brandSources).set({ status: "failed", updatedAt: new Date() }).where(and(inArray(schema.brandSources.status, ["queued", "running"]), lt(schema.brandSources.updatedAt, cutoff)));
}
