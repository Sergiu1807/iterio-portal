import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { buildBrandGrounding } from "@/lib/brand-grounding";
import { SYSTEM_KEY, GEN_MODEL, GEN_TEMPERATURE, GEN_TIMEOUT_MS, DEFAULT_VARIANTS, MAX_VARIANTS } from "./constants";
import { EMIT_COPY, COPY_SYSTEM, buildCopyUserMessage, scanCopyCompliance, type RawCopy } from "./prompt";

type BatchRow = typeof schema.adCopyBatches.$inferSelect;

export type StartCopyOpts = { brandId: string; angleId?: string | null; briefId?: string | null; placement?: string; variantCount?: number; funnelStage?: string };

export async function startCopy(opts: StartCopyOpts): Promise<{ batchId: string }> {
  if (!opts.angleId && !opts.briefId) throw new Error("angleId or briefId required");
  const grounding = await buildBrandGrounding(opts.brandId);
  const [row] = await db
    .insert(schema.adCopyBatches)
    .values({
      brandId: opts.brandId,
      angleId: opts.angleId ?? null,
      briefId: opts.briefId ?? null,
      placement: opts.placement || "feed",
      variantCount: Math.min(MAX_VARIANTS, Math.max(1, opts.variantCount ?? DEFAULT_VARIANTS)),
      funnelStage: opts.funnelStage ?? null,
      status: "pending",
      groundingSource: grounding.source,
      b3Version: grounding.version,
    })
    .returning({ id: schema.adCopyBatches.id });
  return { batchId: row.id };
}

/** Build the "what this copy is for" context from the source angle or brief. */
async function sourceContext(batch: BatchRow): Promise<string> {
  if (batch.briefId) {
    const [b] = await db.select().from(schema.briefs).where(eq(schema.briefs.id, batch.briefId)).limit(1);
    if (b) {
      const angle = b.angleId ? (await db.select().from(schema.angles).where(eq(schema.angles.id, b.angleId)).limit(1))[0] : null;
      return [
        `This copy ships WITH a ${b.format} creative built from this brief.`,
        angle?.bigIdea ? `Concept: ${angle.bigIdea}` : "",
        angle?.hook ? `Creative hook: ${angle.hook}` : "",
        angle?.targetPersona ? `Persona: ${angle.targetPersona}` : "",
        angle?.proofMechanism ? `Proof: ${angle.proofMechanism}` : "",
        `Brief detail: ${JSON.stringify(b.briefJson ?? {}).slice(0, 1500)}`,
      ].filter(Boolean).join("\n");
    }
  }
  if (batch.angleId) {
    const [a] = await db.select().from(schema.angles).where(eq(schema.angles.id, batch.angleId)).limit(1);
    if (a) return [`This copy is for an ad built on this angle.`, a.bigIdea ? `Concept: ${a.bigIdea}` : "", a.hook ? `Hook: ${a.hook}` : "", a.emotionalDriver ? `Driver: ${a.emotionalDriver}` : "", a.targetPersona ? `Persona: ${a.targetPersona}` : "", a.proofMechanism ? `Proof: ${a.proofMechanism}` : ""].filter(Boolean).join("\n");
  }
  return "Write general on-brand ad copy.";
}

export type CopyInsert = Omit<typeof schema.adCopy.$inferInsert, "batchId" | "brandId">;

export async function generateCopyForBatch(batch: BatchRow): Promise<{ copies: CopyInsert[]; groundingSource: string; b3Version: number | null }> {
  const grounding = await buildBrandGrounding(batch.brandId);
  const ctx = await sourceContext(batch);

  const resp = await callClaude({
    model: GEN_MODEL,
    temperature: GEN_TEMPERATURE,
    maxTokens: 3000,
    timeoutMs: GEN_TIMEOUT_MS,
    system: COPY_SYSTEM,
    messages: [{ role: "user", content: buildCopyUserMessage(grounding, { placement: batch.placement, variantCount: batch.variantCount, funnelStage: batch.funnelStage ?? "TOF", sourceContext: ctx }) }],
    tools: [EMIT_COPY],
    toolChoice: { type: "tool", name: "emit_copy" },
    systemKey: SYSTEM_KEY,
    brandId: batch.brandId,
  });

  const out = toolResult<{ variants?: RawCopy[] }>(resp, "emit_copy");
  const raw = Array.isArray(out?.variants) ? out!.variants : [];
  if (!raw.length) throw new Error("copy generation returned nothing");

  const bannedSubjects = grounding.compliance.rules.filter((r) => String(r.verdict).toLowerCase() === "banned").map((r) => r.subject ?? "").filter(Boolean);
  const copies: CopyInsert[] = raw.slice(0, MAX_VARIANTS).map((c, i) => {
    const { flag, ruleRef } = scanCopyCompliance(c, grounding.compliance.banned_phrasings, bannedSubjects);
    return {
      angleId: batch.angleId,
      briefId: batch.briefId,
      placement: batch.placement,
      primaryText: c.primary_text ?? null,
      headline: c.headline ?? null,
      cta: c.cta ?? null,
      variantIndex: i + 1,
      complianceFlag: flag,
      ruleRef,
      status: "draft",
    };
  });
  return { copies, groundingSource: grounding.source, b3Version: grounding.version };
}
