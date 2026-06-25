import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { buildBrandGrounding } from "@/lib/brand-grounding";
import { SYSTEM_KEY, GEN_MODEL, GEN_TEMPERATURE, GEN_TIMEOUT_MS, MAX_COUNT, DEFAULT_COUNT } from "./constants";
import { EMIT_ANGLES_TOOL, IDEATION_SYSTEM, buildIdeationUserMessage, complianceScan, type GenParams, type RawAngle } from "./prompt";

type BatchRow = typeof schema.angleBatches.$inferSelect;

export type StartIdeationOpts = {
  brandId: string;
  productId?: string | null;
  objective?: string;
  funnelStage?: string;
  formats?: string[];
  count?: number;
  theme?: string;
  seedAngleId?: string | null;
};

/** Insert a pending batch (the queue item). The tick/cron claims + runs it. */
export async function startIdeation(opts: StartIdeationOpts): Promise<{ batchId: string }> {
  const grounding = await buildBrandGrounding(opts.brandId); // cheap (DB reads) — record what it'll ground on
  const count = Math.min(MAX_COUNT, Math.max(1, opts.count ?? DEFAULT_COUNT));
  const [row] = await db
    .insert(schema.angleBatches)
    .values({
      brandId: opts.brandId,
      productId: opts.productId ?? null,
      objective: opts.objective?.trim() || null,
      funnelStage: opts.funnelStage || "TOF",
      formats: (opts.formats?.length ? opts.formats : ["any"]) as string[],
      count,
      theme: opts.theme?.trim() || null,
      seedAngleId: opts.seedAngleId ?? null,
      status: "pending",
      groundingSource: grounding.source,
      b3Version: grounding.version,
      paramsJson: { objective: opts.objective ?? null, funnelStage: opts.funnelStage ?? "TOF", formats: opts.formats ?? ["any"], productId: opts.productId ?? null },
    })
    .returning({ id: schema.angleBatches.id });
  return { batchId: row.id };
}

export type AngleInsert = Omit<typeof schema.angles.$inferInsert, "batchId" | "brandId">;

/** Run the Claude generation for a claimed batch → parsed + compliance-scanned angle rows. */
export async function generateAnglesForBatch(batch: BatchRow): Promise<{ angles: AngleInsert[]; groundingSource: string; b3Version: number | null }> {
  const grounding = await buildBrandGrounding(batch.brandId);

  // product name (for the prompt) + regenerate-similar seed
  let productName: string | undefined;
  if (batch.productId) {
    const [p] = await db.select({ name: schema.products.name }).from(schema.products).where(eq(schema.products.id, batch.productId)).limit(1);
    productName = p?.name;
  }
  let seedAngle: GenParams["seedAngle"];
  if (batch.seedAngleId) {
    const [s] = await db.select({ title: schema.angles.title, bigIdea: schema.angles.bigIdea, emotionalDriver: schema.angles.emotionalDriver }).from(schema.angles).where(eq(schema.angles.id, batch.seedAngleId)).limit(1);
    if (s) seedAngle = { title: s.title, bigIdea: s.bigIdea ?? undefined, emotionalDriver: s.emotionalDriver ?? undefined };
  }

  const params: GenParams = {
    objective: batch.objective ?? undefined,
    funnelStage: batch.funnelStage,
    formats: batch.formats ?? ["any"],
    count: batch.count,
    theme: batch.theme ?? undefined,
    productName,
    seedAngle,
  };

  const resp = await callClaude({
    model: GEN_MODEL,
    temperature: GEN_TEMPERATURE,
    maxTokens: 8000,
    timeoutMs: GEN_TIMEOUT_MS,
    system: IDEATION_SYSTEM,
    messages: [{ role: "user", content: buildIdeationUserMessage(grounding, params) }],
    tools: [EMIT_ANGLES_TOOL],
    toolChoice: { type: "tool", name: "emit_angles" },
    systemKey: SYSTEM_KEY,
    brandId: batch.brandId,
  });

  const out = toolResult<{ angles?: RawAngle[] }>(resp, "emit_angles");
  const raw = Array.isArray(out?.angles) ? out!.angles : [];
  if (!raw.length) throw new Error("angle generation returned nothing");

  const bannedSubjects = grounding.compliance.rules.filter((r) => String(r.verdict).toLowerCase() === "banned").map((r) => r.subject ?? "").filter(Boolean);
  const clamp = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : null; };

  const angles: AngleInsert[] = raw.slice(0, MAX_COUNT).map((a) => {
    const { flag, ruleRef } = complianceScan(a, grounding.compliance.banned_phrasings, bannedSubjects);
    const score = clamp(a.score);
    return {
      title: String(a.title ?? "Untitled angle").slice(0, 300),
      format: (a.format ?? "any").toLowerCase(),
      funnelStage: a.funnel_stage ?? batch.funnelStage,
      bigIdea: a.big_idea ?? null,
      hook: a.hook ?? null,
      emotionalDriver: a.emotional_driver ?? null,
      targetPersona: a.target_persona ?? null,
      proofMechanism: a.proof_mechanism ?? null,
      complianceFlag: flag,
      ruleRef,
      sourceInspiration: a.source_inspiration ?? null,
      differentiationNote: a.differentiation_note ?? null,
      score: score != null ? score.toFixed(2) : null,
      status: "draft",
    };
  });

  return { angles, groundingSource: grounding.source, b3Version: grounding.version };
}
