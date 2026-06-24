import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { getApiKey } from "@/lib/api-keys";
import { startApifyRun, getApifyRun, listApifyDataset, recordApifyUsage } from "@/lib/providers/apify";
import { WaitError } from "./wait-error";

export const SYSTEM_KEY = "brand-onboarding";

type SourceRow = typeof schema.brandSources.$inferSelect;
type JobRow = typeof schema.researchJobs.$inferSelect;

/** Best-effort PII scrub — strip identifiers, keep verbatim wording. */
export function scrubPII(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b\+?\d[\d\s().-]{7,}\d\b/g, "[phone]")
    .replace(/(^|\s)@\w{2,}/g, "$1[handle]");
}

// Scraped item shapes vary per actor — pull each field from a list of candidate keys.
export function pick(item: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) { const v = item[k]; if (v != null && v !== "") return v; }
  return undefined;
}
export function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (v && typeof v === "object") { const inner = pick(v as Record<string, unknown>, ["ratingValue", "value", "rating", "stars"]); if (inner != null) return toNumber(inner); }
  if (typeof v === "string") { const m = v.match(/\d+(\.\d+)?/); if (m) return parseFloat(m[0]); }
  return undefined;
}
export const TEXT_KEYS = ["text", "reviewText", "review", "body", "content", "comment", "commentBody", "selftext", "reviewBody", "reviewDescription", "description", "snippet", "reviewContent", "message", "caption"];
export const TITLE_KEYS = ["title", "heading", "reviewTitle", "headline", "reviewHeader", "summary", "postTitle"];
export const RATING_KEYS = ["rating", "stars", "score", "reviewRating", "ratingValue", "starRating", "numberOfStars", "reviewScore", "star"];
export const DATE_KEYS = ["date", "publishedDate", "datePublished", "reviewDate", "publishedAtDate", "reviewedAt", "createdAt", "time", "datetime", "experienceDate", "reviewCreatedAt"];

export type NormReview = { text: string; rating?: number; title?: string; date?: string };
export function normalizeReview(item: Record<string, unknown>): NormReview | null {
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
export function ratingDistribution(reviews: NormReview[]): string {
  const rated = reviews.filter((r) => typeof r.rating === "number") as (NormReview & { rating: number })[];
  if (!rated.length) return "";
  const buckets: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of rated) { const b = Math.min(5, Math.max(1, Math.round(r.rating))); buckets[b]++; sum += r.rating; }
  return `Avg ${(sum / rated.length).toFixed(2)}/5 across ${rated.length} rated reviews — ${[5, 4, 3, 2, 1].map((s) => `${s}★:${buckets[s]}`).join("  ")}`;
}

const VOC_TOOL: Anthropic.Tool = {
  name: "emit_voc",
  description: "Structured voice-of-customer extracted from real customer language. Use the customers' own words verbatim; never include names or PII.",
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
      field_confidence: { type: "number", description: "0..1 given the volume of real customer text available." },
    },
    required: ["verbatim_phrases"],
  },
};

/** Shared VOC extraction → upsert. `floor` raises confidence when fed real customer text. */
export async function extractVoc(
  job: JobRow,
  source: SourceRow,
  label: string,
  brandName: string,
  evidence: string,
  opts: { ratingSummary?: string; reviewCount?: number; floor?: number; extra?: Record<string, unknown> } = {}
): Promise<void> {
  const resp = await callClaude({
    model: "claude-sonnet-4-6",
    maxTokens: 2200,
    system:
      "You extract verbatim voice-of-customer from real customer language (reviews, community posts, social comments) for a brand. Quote customers' exact words; capture before→after transformations, objections, desires, pains, and persona signals. NEVER include names, emails, handles or any PII. Lower field_confidence when little real customer text is available.",
    messages: [{ role: "user", content: `Brand: ${brandName}\nSource: ${label}\n\n${evidence}\n\nReturn the structured VOC via emit_voc.` }],
    tools: [VOC_TOOL],
    toolChoice: { type: "tool", name: "emit_voc" },
    systemKey: SYSTEM_KEY,
    brandId: job.brandId,
  });
  const out = toolResult<Record<string, unknown> & { field_confidence?: number }>(resp, "emit_voc");
  if (!out) throw new Error("VOC extraction returned nothing");
  if (opts.ratingSummary) out.rating_summary = opts.ratingSummary;
  if (opts.reviewCount != null) out.review_count = opts.reviewCount;
  if (opts.extra) for (const [k, v] of Object.entries(opts.extra)) out[k] = v;
  out.source_kind = opts.floor && opts.floor >= 0.8 ? "apify_scrape" : "web_research";

  let confidence = Math.max(0, Math.min(1, typeof out.field_confidence === "number" ? out.field_confidence : 0.5));
  if (opts.floor) confidence = Math.max(confidence, opts.floor);
  await db
    .insert(schema.extractions)
    .values({ brandId: job.brandId, sourceId: source.id, jobId: job.id, schemaType: "voc", json: out, confidence: confidence.toFixed(3), model: "claude-sonnet-4-6" })
    .onConflictDoUpdate({ target: [schema.extractions.sourceId, schema.extractions.schemaType], set: { json: out, confidence: confidence.toFixed(3), jobId: job.id, updatedAt: new Date() } });
}

/** Record a thin, honest VOC extraction when nothing could be scraped. */
export async function thinVoc(job: JobRow, source: SourceRow, note: string): Promise<void> {
  await db
    .insert(schema.extractions)
    .values({ brandId: job.brandId, sourceId: source.id, jobId: job.id, schemaType: "voc", json: { verbatim_phrases: [], note }, confidence: "0.100", model: "internal" })
    .onConflictDoUpdate({ target: [schema.extractions.sourceId, schema.extractions.schemaType], set: { json: { verbatim_phrases: [], note }, jobId: job.id, updatedAt: new Date() } });
}

export type PrepResult = { evidence: string; count: number; rawMeta: Record<string, unknown>; ratingSummary?: string; extra?: Record<string, unknown> };
export type VocScrapeConfig = {
  actorId: string;
  buildInput: (source: SourceRow, brandName: string, max: number) => Record<string, unknown>;
  prepareEvidence: (items: Record<string, unknown>[], brandName: string) => PrepResult;
  label: string; // human label for the source
  kind: string; // raw_artifacts.kind: review | post
  floor?: number; // confidence floor when real data is present
  defaultMax?: number;
};

/**
 * Generic async-Apify → VOC runner shared by reviews / reddit / social. Fires the actor,
 * polls across passes via WaitError (no attempt burn), then normalises + extracts VOC.
 * Returns true if a VOC extraction was produced; false if Apify is unconfigured / the run
 * failed / it returned nothing usable (the caller decides on a fallback).
 */
export async function runApifyVocScrape(job: JobRow, source: SourceRow, brandName: string, cfg: VocScrapeConfig): Promise<boolean> {
  const token = await getApiKey("APIFY_TOKEN");
  if (!token) return false;
  const max = Number((source.config as { maxItems?: number } | null)?.maxItems) || cfg.defaultMax || 60;

  if (!job.apifyRunId) {
    const input = cfg.buildInput(source, brandName, max);
    const { runId, datasetId } = await startApifyRun(cfg.actorId, input);
    await db.update(schema.researchJobs).set({ apifyRunId: runId, apifyDatasetId: datasetId ?? null, provider: "apify", updatedAt: new Date() }).where(eq(schema.researchJobs.id, job.id));
    throw new WaitError(`${cfg.label} scrape started`); // poll on the next pass
  }
  const info = await getApifyRun(job.apifyRunId);
  if (info.status === "READY" || info.status === "RUNNING") throw new WaitError(`${cfg.label} scrape running`);
  if (info.status === "SUCCEEDED") {
    const dsId = info.datasetId ?? job.apifyDatasetId ?? "";
    const items = dsId ? await listApifyDataset<Record<string, unknown>>(dsId, Math.max(120, max + 40)) : [];
    await recordApifyUsage({ runId: job.apifyRunId, usageUsd: info.usageUsd, systemKey: SYSTEM_KEY, brandId: job.brandId });
    const prep = cfg.prepareEvidence(items, brandName);
    if (prep.count > 0) {
      await db
        .insert(schema.rawArtifacts)
        .values({ brandId: job.brandId, jobId: job.id, kind: cfg.kind, externalId: `${source.type}:apify:${job.apifyRunId}`, meta: { ...prep.rawMeta, source: "apify", actorId: cfg.actorId, count: prep.count } })
        .onConflictDoNothing();
      await extractVoc(job, source, cfg.label, brandName, prep.evidence, { ratingSummary: prep.ratingSummary, reviewCount: prep.count, floor: cfg.floor ?? 0.8, extra: prep.extra });
      return true;
    }
    console.warn(`[${cfg.kind}] apify ${cfg.label} returned 0 usable items — falling back`);
    return false;
  }
  console.warn(`[${cfg.kind}] apify ${cfg.label} run ${info.status} — falling back`);
  return false;
}
