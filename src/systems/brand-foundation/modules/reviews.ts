import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { tavilySearch } from "@/lib/providers/tavily";
import { fetchWebsiteText } from "@/lib/storage";

const SYSTEM_KEY = "brand-onboarding";

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

/** Reviews/VOC module: gather review text (page + Tavily), scrub PII, extract VOC. */
export async function runReviewsJob(job: JobRow, source: SourceRow): Promise<void> {
  const url = source.url ?? "";
  const site = SITE_LABEL[source.type] ?? source.type;
  const [brand] = await db.select({ name: schema.brands.name }).from(schema.brands).where(eq(schema.brands.id, job.brandId)).limit(1);
  const brandName = brand?.name ?? "";

  const pageText = url ? scrubPII((await fetchWebsiteText(url, { maxChars: 12000 })) ?? "") : "";
  const tav = await tavilySearch({
    query: `${brandName} customer reviews on ${site} — what people praise, complaints, before and after, who buys it`,
    searchDepth: "advanced",
    includeAnswer: true,
    maxResults: 10,
    systemKey: SYSTEM_KEY,
    brandId: job.brandId,
  });
  const tavText = scrubPII([tav.answer, ...tav.results.map((r) => `${r.title}: ${r.content}`)].filter(Boolean).join("\n"));

  await db
    .insert(schema.rawArtifacts)
    .values({ brandId: job.brandId, jobId: job.id, kind: "review", externalId: url || `${source.type}:${source.id}`, meta: { site, url, text: pageText.slice(0, 14000), tavilyAnswer: tav.answer, sources: tav.results.map((r) => ({ title: r.title, url: r.url })) } })
    .onConflictDoNothing();

  const evidence = [pageText ? `REVIEW PAGE (${site}):\n${pageText.slice(0, 9000)}` : "", `\nWEB RESEARCH:\n${tavText.slice(0, 6000)}`].join("\n");
  const resp = await callClaude({
    model: "claude-sonnet-4-6",
    maxTokens: 2000,
    system: "You extract verbatim voice-of-customer from reviews for a brand. Quote customers' exact words; capture before→after transformations, objections, desires, pains. NEVER include names, emails, handles or any PII. Lower field_confidence when little real review text is available.",
    messages: [{ role: "user", content: `Brand: ${brandName}\nReview source: ${site}\n\n${evidence}\n\nReturn the structured VOC via emit_voc.` }],
    tools: [VOC_TOOL],
    toolChoice: { type: "tool", name: "emit_voc" },
    systemKey: SYSTEM_KEY,
    brandId: job.brandId,
  });
  const out = toolResult<Record<string, unknown> & { field_confidence?: number }>(resp, "emit_voc");
  if (!out) throw new Error("VOC extraction returned nothing");

  const confidence = Math.max(0, Math.min(1, typeof out.field_confidence === "number" ? out.field_confidence : 0.5));
  await db
    .insert(schema.extractions)
    .values({ brandId: job.brandId, sourceId: source.id, jobId: job.id, schemaType: "voc", json: out, confidence: confidence.toFixed(3), model: "claude-sonnet-4-6" })
    .onConflictDoUpdate({ target: [schema.extractions.sourceId, schema.extractions.schemaType], set: { json: out, confidence: confidence.toFixed(3), jobId: job.id, updatedAt: new Date() } });
}
