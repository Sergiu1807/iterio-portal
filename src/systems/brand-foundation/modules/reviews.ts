import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { tavilySearch } from "@/lib/providers/tavily";
import { fetchWebsiteText } from "@/lib/storage";
import { getApiKey } from "@/lib/api-keys";
import { startApifyRun, getApifyRun, listApifyDataset, recordApifyUsage } from "@/lib/providers/apify";
import { WaitError } from "./wait-error";

const SYSTEM_KEY = "brand-onboarding";
const DEFAULT_MAX_REVIEWS = 60;

type SourceRow = typeof schema.brandSources.$inferSelect;
type JobRow = typeof schema.researchJobs.$inferSelect;

const SITE_LABEL: Record<string, string> = { amazon: "Amazon", trustpilot: "Trustpilot", google_reviews: "Google" };

/** Best-effort PII scrub — strip identifiers, keep verbatim wording. */
function scrubPII(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b\+?\d[\d\s().-]{7,}\d\b/g, "[phone]")
    .replace(/(^|\s)@\w{2,}/g, "$1[handle]");
}

// ── Apify review actors (chosen by usage + success rate; output normalised defensively) ──
type ReviewActor = { actorId: string; buildInput: (url: string, max: number, cfg: Record<string, unknown>) => Record<string, unknown> };
const REVIEW_ACTORS: Record<string, ReviewActor> = {
  trustpilot: {
    actorId: "6q70QEFc2Zk0ObldU", // automation-lab/trustpilot — 97% success, $0.25/1K
    buildInput: (url, max) => ({ companyUrls: [url], maxReviewsPerCompany: max, sort: "recency", languages: ["en"], includeCompanyInfo: true }),
  },
  amazon: {
    actorId: "gFtgG31RZJYlphznm", // web_wanderer/amazon-reviews-extractor — 4.7★, 96% success
    buildInput: (url, max, cfg) => ({ products: [url], limit: Math.min(10, Math.max(2, Math.ceil(max / 10))), sort: "recent", region: String(cfg.region ?? "amazon.com"), language: "all", personal_data: false }),
  },
  google_reviews: {
    actorId: "Xb8osYTtOjlsgI6k9", // compass/Google-Maps-Reviews-Scraper — 44K users, 99% success
    buildInput: (url, max) => ({ startUrls: [{ url }], maxReviews: max, reviewsSort: "newest", language: "en", personalData: false }),
  },
};

// Review item shapes vary per actor — pull each field from a list of candidate keys.
type NormReview = { text: string; rating?: number; title?: string; date?: string };
const TEXT_KEYS = ["text", "reviewText", "review", "body", "content", "comment", "reviewBody", "reviewDescription", "description", "snippet", "reviewContent", "message"];
const TITLE_KEYS = ["title", "heading", "reviewTitle", "headline", "reviewHeader", "summary"];
const RATING_KEYS = ["rating", "stars", "score", "reviewRating", "ratingValue", "starRating", "numberOfStars", "reviewScore", "star", "stargazers"];
const DATE_KEYS = ["date", "publishedDate", "datePublished", "reviewDate", "publishedAtDate", "reviewedAt", "createdAt", "time", "datetime", "experienceDate", "reviewCreatedAt"];

function pick(item: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) { const v = item[k]; if (v != null && v !== "") return v; }
  return undefined;
}
function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (v && typeof v === "object") { const inner = pick(v as Record<string, unknown>, ["ratingValue", "value", "rating", "stars"]); if (inner != null) return toNumber(inner); }
  if (typeof v === "string") { const m = v.match(/\d+(\.\d+)?/); if (m) return parseFloat(m[0]); }
  return undefined;
}
function normalizeReview(item: Record<string, unknown>): NormReview | null {
  const text = String(pick(item, TEXT_KEYS) ?? "").trim();
  if (text.length < 3) return null;
  const r = toNumber(pick(item, RATING_KEYS));
  const titleRaw = pick(item, TITLE_KEYS);
  const dateRaw = pick(item, DATE_KEYS);
  return {
    text,
    rating: typeof r === "number" && r >= 0 && r <= 5 ? r : undefined,
    title: titleRaw ? String(titleRaw).trim().slice(0, 200) : undefined,
    date: dateRaw ? String(dateRaw).slice(0, 10) : undefined,
  };
}
function ratingDistribution(reviews: NormReview[]): string {
  const rated = reviews.filter((r) => typeof r.rating === "number") as (NormReview & { rating: number })[];
  if (!rated.length) return "";
  const buckets: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of rated) { const b = Math.min(5, Math.max(1, Math.round(r.rating))); buckets[b]++; sum += r.rating; }
  return `Avg ${(sum / rated.length).toFixed(2)}/5 across ${rated.length} rated reviews — ${[5, 4, 3, 2, 1].map((s) => `${s}★:${buckets[s]}`).join("  ")}`;
}

const VOC_TOOL: Anthropic.Tool = {
  name: "emit_voc",
  description: "Structured voice-of-customer extracted from reviews. Use the customers' own words verbatim; never include names or PII.",
  input_schema: {
    type: "object",
    properties: {
      verbatim_phrases: { type: "array", items: { type: "string" }, description: "Exact customer phrases (no names/PII)." },
      before_after: { type: "array", items: { type: "object", properties: { before: { type: "string" }, after: { type: "string" } } } },
      objections: { type: "array", items: { type: "string" } },
      desires: { type: "array", items: { type: "string" } },
      pains: { type: "array", items: { type: "string" } },
      persona_signals: { type: "array", items: { type: "string" } },
      rating_summary: { type: "string", description: "Overall sentiment / rating distribution if discernible." },
      field_confidence: { type: "number", description: "0..1 given the volume of real review text available." },
    },
    required: ["verbatim_phrases"],
  },
};

/** Shared VOC extraction → upsert. `floor` raises confidence when fed real review text. */
async function extractVoc(
  job: JobRow,
  source: SourceRow,
  site: string,
  brandName: string,
  evidence: string,
  opts: { ratingSummary?: string; reviewCount?: number; floor?: number } = {}
): Promise<void> {
  const resp = await callClaude({
    model: "claude-sonnet-4-6",
    maxTokens: 2200,
    system:
      "You extract verbatim voice-of-customer from reviews for a brand. Quote customers' exact words; capture before→after transformations, objections, desires, pains, and persona signals. NEVER include names, emails, handles or any PII. Lower field_confidence when little real review text is available.",
    messages: [{ role: "user", content: `Brand: ${brandName}\nReview source: ${site}\n\n${evidence}\n\nReturn the structured VOC via emit_voc.` }],
    tools: [VOC_TOOL],
    toolChoice: { type: "tool", name: "emit_voc" },
    systemKey: SYSTEM_KEY,
    brandId: job.brandId,
  });
  const out = toolResult<Record<string, unknown> & { field_confidence?: number }>(resp, "emit_voc");
  if (!out) throw new Error("VOC extraction returned nothing");
  // Deterministic overrides from the real review set (don't trust the LLM to count).
  if (opts.ratingSummary) out.rating_summary = opts.ratingSummary;
  if (opts.reviewCount != null) out.review_count = opts.reviewCount;
  out.source_kind = opts.floor && opts.floor >= 0.8 ? "apify_reviews" : "web_research";

  let confidence = Math.max(0, Math.min(1, typeof out.field_confidence === "number" ? out.field_confidence : 0.5));
  if (opts.floor) confidence = Math.max(confidence, opts.floor);
  await db
    .insert(schema.extractions)
    .values({ brandId: job.brandId, sourceId: source.id, jobId: job.id, schemaType: "voc", json: out, confidence: confidence.toFixed(3), model: "claude-sonnet-4-6" })
    .onConflictDoUpdate({ target: [schema.extractions.sourceId, schema.extractions.schemaType], set: { json: out, confidence: confidence.toFixed(3), jobId: job.id, updatedAt: new Date() } });
}

/**
 * Reviews/VOC module. Preferred path: a dedicated Apify review actor scrapes REAL
 * verbatim reviews (async — polled across passes via WaitError). Fallback: Tavily +
 * page fetch (degrades gracefully when Apify is unconfigured / fails / returns nothing).
 */
export async function runReviewsJob(job: JobRow, source: SourceRow): Promise<void> {
  const url = source.url ?? "";
  const site = SITE_LABEL[source.type] ?? source.type;
  const [brand] = await db.select({ name: schema.brands.name }).from(schema.brands).where(eq(schema.brands.id, job.brandId)).limit(1);
  const brandName = brand?.name ?? "";

  // ── Apify real-review path ──
  const actor = REVIEW_ACTORS[source.type];
  const apifyToken = actor && url ? await getApiKey("APIFY_TOKEN") : "";
  if (actor && url && apifyToken) {
    const max = Number((source.config as { maxItems?: number } | null)?.maxItems) || DEFAULT_MAX_REVIEWS;
    if (!job.apifyRunId) {
      const input = actor.buildInput(url, max, (source.config ?? {}) as Record<string, unknown>);
      const { runId, datasetId } = await startApifyRun(actor.actorId, input);
      await db.update(schema.researchJobs).set({ apifyRunId: runId, apifyDatasetId: datasetId ?? null, provider: "apify", updatedAt: new Date() }).where(eq(schema.researchJobs.id, job.id));
      throw new WaitError("review scrape started"); // poll on the next pass (no attempt burn)
    }
    const info = await getApifyRun(job.apifyRunId);
    if (info.status === "READY" || info.status === "RUNNING") throw new WaitError("review scrape running");
    if (info.status === "SUCCEEDED") {
      const dsId = info.datasetId ?? job.apifyDatasetId ?? "";
      const items = dsId ? await listApifyDataset<Record<string, unknown>>(dsId, Math.max(80, max + 40)) : [];
      await recordApifyUsage({ runId: job.apifyRunId, usageUsd: info.usageUsd, systemKey: SYSTEM_KEY, brandId: job.brandId });
      const reviews = items.map(normalizeReview).filter((r): r is NormReview => !!r).slice(0, 300);
      if (reviews.length) {
        const distro = ratingDistribution(reviews);
        await db
          .insert(schema.rawArtifacts)
          .values({ brandId: job.brandId, jobId: job.id, kind: "review", externalId: `${source.type}:apify:${job.apifyRunId}`, meta: { site, url, source: "apify", actorId: actor.actorId, count: reviews.length, distribution: distro, sample: reviews.slice(0, 20) } })
          .onConflictDoNothing();
        const block = reviews.map((r, i) => `#${i + 1} ${r.rating ? `(${r.rating}★) ` : ""}${r.title ? `${r.title}: ` : ""}${r.text}`).join("\n");
        const evidence = `REAL ${site.toUpperCase()} REVIEWS (${reviews.length} scraped${distro ? `; ${distro}` : ""}):\n${scrubPII(block).slice(0, 16000)}`;
        await extractVoc(job, source, site, brandName, evidence, { ratingSummary: distro, reviewCount: reviews.length, floor: 0.85 });
        return;
      }
      console.warn(`[reviews] apify ${site} returned 0 reviews — falling back to web research`);
    } else {
      console.warn(`[reviews] apify ${site} run ${info.status} — falling back to web research`);
    }
    // Apify failed or returned nothing → continue to the web-research fallback below.
  }

  // ── Tavily + page-fetch fallback ──
  const pageText = url ? scrubPII((await fetchWebsiteText(url, { maxChars: 12000 })) ?? "") : "";
  let tav: { answer: string; results: { title: string; url: string; content: string }[] } = { answer: "", results: [] };
  try {
    tav = await tavilySearch({
      query: `${brandName} customer reviews on ${site} — what people praise, complaints, before and after, who buys it`,
      searchDepth: "advanced",
      includeAnswer: true,
      maxResults: 10,
      systemKey: SYSTEM_KEY,
      brandId: job.brandId,
    });
  } catch (e) {
    console.warn("[reviews] tavily unavailable:", String(e).slice(0, 100));
  }
  if (!pageText && !tav.answer && !tav.results.length) {
    // nothing to extract — record a thin, honest result
    const note = `No accessible review content for ${site} (scrape + page + web research unavailable).`;
    await db
      .insert(schema.extractions)
      .values({ brandId: job.brandId, sourceId: source.id, jobId: job.id, schemaType: "voc", json: { verbatim_phrases: [], note }, confidence: "0.100", model: "internal" })
      .onConflictDoUpdate({ target: [schema.extractions.sourceId, schema.extractions.schemaType], set: { json: { verbatim_phrases: [], note }, jobId: job.id, updatedAt: new Date() } });
    return;
  }
  const tavText = scrubPII([tav.answer, ...tav.results.map((r) => `${r.title}: ${r.content}`)].filter(Boolean).join("\n"));
  await db
    .insert(schema.rawArtifacts)
    .values({ brandId: job.brandId, jobId: job.id, kind: "review", externalId: url || `${source.type}:${source.id}`, meta: { site, url, source: "web", text: pageText.slice(0, 14000), tavilyAnswer: tav.answer, sources: tav.results.map((r) => ({ title: r.title, url: r.url })) } })
    .onConflictDoNothing();
  const evidence = [pageText ? `REVIEW PAGE (${site}):\n${pageText.slice(0, 9000)}` : "", `\nWEB RESEARCH:\n${tavText.slice(0, 6000)}`].join("\n");
  await extractVoc(job, source, site, brandName, evidence);
}
