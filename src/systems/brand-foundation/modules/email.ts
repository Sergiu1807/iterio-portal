import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { SYSTEM_KEY, scrubPII } from "./voc-common";

type SourceRow = typeof schema.brandSources.$inferSelect;
type JobRow = typeof schema.researchJobs.$inferSelect;

// Email is the brand's OWN marketing voice/offers (not customer VOC) — its own schema type.
const EMAIL_TOOL: Anthropic.Tool = {
  name: "emit_email_intel",
  description: "Structure the brand's marketing-email voice, signature phrasing, offers and promo mechanics from pasted emails.",
  input_schema: {
    type: "object",
    properties: {
      voice_tone: { type: "string", description: "How the brand sounds in email (tone, register, energy)." },
      signature_phrases: { type: "array", items: { type: "string" }, description: "Recurring on-brand phrases / taglines used verbatim." },
      subject_line_styles: { type: "array", items: { type: "string" }, description: "Patterns in subject lines (curiosity, urgency, benefit, emoji, etc.)." },
      offers: { type: "array", items: { type: "string" }, description: "Offers/promos run via email (discounts, bundles, subscriptions)." },
      promo_mechanics: { type: "array", items: { type: "string" }, description: "Urgency/scarcity/social-proof mechanics used." },
      cta_styles: { type: "array", items: { type: "string" }, description: "Call-to-action wording patterns." },
      field_confidence: { type: "number", description: "0..1 given the amount of real email copy provided." },
    },
    required: ["voice_tone"],
  },
};

/** Email module: operator-pasted marketing emails → brand voice / offers extraction. */
export async function runEmailJob(job: JobRow, source: SourceRow): Promise<void> {
  const text = String((source.config as { text?: string } | null)?.text ?? "").trim();
  const [brand] = await db.select({ name: schema.brands.name }).from(schema.brands).where(eq(schema.brands.id, job.brandId)).limit(1);
  const brandName = brand?.name ?? "";

  if (text.length < 40) {
    await db
      .insert(schema.extractions)
      .values({ brandId: job.brandId, sourceId: source.id, jobId: job.id, schemaType: "email_intel", json: { voice_tone: "", note: "No marketing-email copy pasted." }, confidence: "0.100", model: "internal" })
      .onConflictDoUpdate({ target: [schema.extractions.sourceId, schema.extractions.schemaType], set: { json: { voice_tone: "", note: "No marketing-email copy pasted." }, jobId: job.id, updatedAt: new Date() } });
    return;
  }

  const scrubbed = scrubPII(text).slice(0, 16000);
  await db
    .insert(schema.rawArtifacts)
    .values({ brandId: job.brandId, jobId: job.id, kind: "asset", externalId: `email:${source.id}`, meta: { source: "email", note: "Operator-pasted marketing emails", text: scrubbed.slice(0, 12000) } })
    .onConflictDoNothing();

  const resp = await callClaude({
    model: "claude-sonnet-4-6",
    maxTokens: 1600,
    system: "You analyse a brand's own marketing emails to capture its voice, signature phrasing, offers and promo mechanics. Quote on-brand phrasing verbatim. Never invent; lower field_confidence when little copy is provided.",
    messages: [{ role: "user", content: `Brand: ${brandName}\n\nMARKETING EMAILS (pasted):\n${scrubbed}\n\nReturn the structured email intel via emit_email_intel.` }],
    tools: [EMAIL_TOOL],
    toolChoice: { type: "tool", name: "emit_email_intel" },
    systemKey: SYSTEM_KEY,
    brandId: job.brandId,
  });
  const out = toolResult<Record<string, unknown> & { field_confidence?: number }>(resp, "emit_email_intel");
  if (!out) throw new Error("email extraction returned nothing");
  const confidence = Math.max(0.5, Math.min(1, typeof out.field_confidence === "number" ? out.field_confidence : 0.7));
  await db
    .insert(schema.extractions)
    .values({ brandId: job.brandId, sourceId: source.id, jobId: job.id, schemaType: "email_intel", json: out, confidence: confidence.toFixed(3), model: "claude-sonnet-4-6" })
    .onConflictDoUpdate({ target: [schema.extractions.sourceId, schema.extractions.schemaType], set: { json: out, confidence: confidence.toFixed(3), jobId: job.id, updatedAt: new Date() } });
}
