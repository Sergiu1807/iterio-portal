import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { buildBrandGrounding } from "@/lib/brand-grounding";
import { SYSTEM_KEY, GEN_MODEL, GEN_TEMPERATURE, GEN_TIMEOUT_MS } from "./constants";
import { EMIT_VIDEO_BRIEF, EMIT_STATIC_BRIEF, BRIEF_SYSTEM, buildBriefUserMessage, carryCompliance, type AngleContext, type ReferenceTeardown } from "./prompt";
import type { ComplianceNotes } from "./types";

type BriefRow = typeof schema.briefs.$inferSelect;
type RefRef = { kind: string; id: string; storageKey?: string | null } | null;

export type StartBriefOpts = { brandId: string; angleId: string; format?: string; depth?: string; notes?: string; referenceRef?: RefRef };

function resolveFormat(opts: StartBriefOpts, angleFormat: string | null): string {
  const f = (opts.format || angleFormat || "static").toLowerCase();
  return f === "any" ? "static" : f;
}

/** Insert a pending brief (the queue item). The tick/cron claims + runs it. */
export async function startBrief(opts: StartBriefOpts): Promise<{ briefId: string }> {
  const [angle] = await db.select().from(schema.angles).where(and(eq(schema.angles.id, opts.angleId), eq(schema.angles.brandId, opts.brandId))).limit(1);
  if (!angle) throw new Error("angle not found");
  const grounding = await buildBrandGrounding(opts.brandId);
  const [row] = await db
    .insert(schema.briefs)
    .values({
      brandId: opts.brandId,
      angleId: angle.id,
      format: resolveFormat(opts, angle.format),
      funnelStage: angle.funnelStage,
      status: "pending",
      groundingSource: grounding.source,
      b3Version: grounding.version,
      referenceRef: opts.referenceRef ?? null,
      depth: opts.depth || "standard",
      notes: opts.notes?.trim() || null,
      complianceNotesJson: { flag: angle.complianceFlag, ruleRef: angle.ruleRef, notes: [] },
    })
    .returning({ id: schema.briefs.id });
  return { briefId: row.id };
}

async function loadReferenceTeardown(ref: RefRef): Promise<ReferenceTeardown> {
  if (!ref?.id) return null;
  if (ref.kind === "competitor_ad") {
    const [a] = await db.select().from(schema.competitorAds).where(eq(schema.competitorAds.id, ref.id)).limit(1);
    if (!a) return null;
    const hook = a.visualHook || a.spokenHook;
    const beats = Array.isArray(a.beatStructure) && a.beatStructure.length ? a.beatStructure.map((b) => `${b.beat}: ${b.text}`).join(" | ") : "";
    const facts = [
      a.creativeAngle ? `Angle: ${a.creativeAngle}` : "",
      hook ? `Hook: ${hook}` : "",
      a.emotionalDriver ? `Emotional driver: ${a.emotionalDriver}` : "",
      a.proofMechanism ? `Proof: ${a.proofMechanism}` : "",
      beats ? `Beat structure: ${beats}` : "",
      a.geminiDescription ? `What it shows: ${String(a.geminiDescription).slice(0, 1200)}` : "",
    ].filter(Boolean).join("\n");
    return { label: "Competitor winner (teardown):", facts: facts || "(no teardown facts)" };
  }
  if (ref.kind === "static") {
    const [s] = await db.select({ finalPrompt: schema.staticAdGenerations.finalPrompt, adCopy: schema.staticAdGenerations.adCopy }).from(schema.staticAdGenerations).where(eq(schema.staticAdGenerations.id, ref.id)).limit(1);
    if (!s) return null;
    const facts = [s.adCopy ? `On-image copy: ${s.adCopy}` : "", s.finalPrompt ? `Composition: ${String(s.finalPrompt).slice(0, 1200)}` : ""].filter(Boolean).join("\n");
    return { label: "Past static (to evolve):", facts: facts || "(no detail)" };
  }
  return null;
}

export type GeneratedBrief = { briefJson: Record<string, unknown>; compliance: ComplianceNotes; groundingSource: string; b3Version: number | null };

/** Run the Claude generation for a claimed brief. */
export async function generateBrief(brief: BriefRow): Promise<GeneratedBrief> {
  if (!brief.angleId) throw new Error("brief has no angle");
  const [angle] = await db.select().from(schema.angles).where(eq(schema.angles.id, brief.angleId)).limit(1);
  if (!angle) throw new Error("angle missing");
  const grounding = await buildBrandGrounding(brief.brandId);
  const reference = await loadReferenceTeardown(brief.referenceRef as RefRef);

  const angleCtx: AngleContext = {
    title: angle.title,
    format: brief.format,
    funnelStage: angle.funnelStage,
    bigIdea: angle.bigIdea,
    hook: angle.hook,
    emotionalDriver: angle.emotionalDriver,
    targetPersona: angle.targetPersona,
    proofMechanism: angle.proofMechanism,
    complianceFlag: angle.complianceFlag,
    ruleRef: angle.ruleRef,
    sourceInspiration: angle.sourceInspiration,
  };

  const isVideo = brief.format === "video";
  const tool = isVideo ? EMIT_VIDEO_BRIEF : EMIT_STATIC_BRIEF;
  const resp = await callClaude({
    model: GEN_MODEL,
    temperature: GEN_TEMPERATURE,
    maxTokens: 6000,
    timeoutMs: GEN_TIMEOUT_MS,
    system: BRIEF_SYSTEM,
    messages: [{ role: "user", content: buildBriefUserMessage(grounding, angleCtx, { format: brief.format, depth: brief.depth, notes: brief.notes }, reference) }],
    tools: [tool],
    toolChoice: { type: "tool", name: tool.name },
    systemKey: SYSTEM_KEY,
    brandId: brief.brandId,
  });

  const out = toolResult<Record<string, unknown> & { compliance_notes?: string[] }>(resp, tool.name);
  if (!out) throw new Error("brief generation returned nothing");
  const modelNotes = Array.isArray(out.compliance_notes) ? out.compliance_notes.map(String) : [];
  const briefJson: Record<string, unknown> = { ...out };
  delete briefJson.compliance_notes;

  const bannedSubjects = grounding.compliance.rules.filter((r) => String(r.verdict).toLowerCase() === "banned").map((r) => r.subject ?? "").filter(Boolean);
  const compliance = carryCompliance(JSON.stringify(briefJson), angle.complianceFlag, angle.ruleRef, grounding.compliance.banned_phrasings, bannedSubjects);
  compliance.notes = [...compliance.notes, ...modelNotes];

  return { briefJson, compliance, groundingSource: grounding.source, b3Version: grounding.version };
}
