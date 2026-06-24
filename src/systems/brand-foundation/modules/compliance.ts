import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { callGemini } from "@/lib/providers/gemini";

const SYSTEM_KEY = "brand-onboarding";

type SourceRow = typeof schema.brandSources.$inferSelect;
type JobRow = typeof schema.researchJobs.$inferSelect;

/** Signals the pipeline to requeue this job (a dependency isn't ready) without burning an attempt. */
export class WaitError extends Error {
  constructor() { super("waiting for dependency"); this.name = "WaitError"; }
}

const COMPLIANCE_TOOL: Anthropic.Tool = {
  name: "emit_compliance",
  description: "Structure the grounded regulatory research into per-claim compliance rules.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      rules: {
        type: "array",
        items: {
          type: "object",
          properties: {
            subject: { type: "string", description: "The ingredient or claim." },
            jurisdiction: { type: "string", enum: ["US_FTC_FDA", "EU_EFSA_DSA"] },
            verdict: { type: "string", enum: ["safe", "risky", "banned"] },
            rationale: { type: "string" },
            evidence_source: { type: "string" },
          },
          required: ["subject", "jurisdiction", "verdict"],
        },
      },
      banned_phrasings: { type: "array", items: { type: "string" } },
      required_disclaimers: { type: "array", items: { type: "string" } },
    },
    required: ["rules"],
  },
};

type Rule = { subject: string; jurisdiction: string; verdict: string; rationale?: string; evidence_source?: string };

export async function runComplianceJob(job: JobRow, source: SourceRow): Promise<void> {
  // Dependency: the website extraction supplies the claim/ingredient set.
  const [web] = await db
    .select()
    .from(schema.extractions)
    .where(and(eq(schema.extractions.brandId, job.brandId), eq(schema.extractions.schemaType, "website_intel")))
    .limit(1);

  if (!web) {
    const [ws] = await db.select({ status: schema.brandSources.status }).from(schema.brandSources).where(and(eq(schema.brandSources.brandId, job.brandId), eq(schema.brandSources.type, "website"))).limit(1);
    if (ws && ["idle", "queued", "running"].includes(ws.status)) throw new WaitError(); // website still researching → retry next pass
  }

  const [brand] = await db.select({ name: schema.brands.name, category: schema.brands.category }).from(schema.brands).where(eq(schema.brands.id, job.brandId)).limit(1);
  const wj = (web?.json ?? {}) as { products?: { claims?: string[]; ingredients?: string[] }[]; value_props?: string[] };
  const ownClaims = new Set<string>();
  const items = new Set<string>();
  for (const p of wj.products ?? []) {
    for (const c of p.claims ?? []) { items.add(c); ownClaims.add(c.toLowerCase()); }
    for (const ing of p.ingredients ?? []) items.add(ing);
  }
  for (const v of wj.value_props ?? []) { items.add(v); ownClaims.add(v.toLowerCase()); }
  const list = Array.from(items).slice(0, 25);

  if (!list.length) {
    await db
      .insert(schema.extractions)
      .values({ brandId: job.brandId, sourceId: source.id, jobId: job.id, schemaType: "compliance", json: { summary: "No specific claims or ingredients found to check.", rules: [] }, confidence: "0.300", model: "internal" })
      .onConflictDoUpdate({ target: [schema.extractions.sourceId, schema.extractions.schemaType], set: { json: { summary: "No specific claims or ingredients found to check.", rules: [] }, jobId: job.id, updatedAt: new Date() } });
    return;
  }

  // 1. Gemini search-grounded regulatory research
  const grounded = await callGemini({
    grounded: true,
    maxOutputTokens: 2600,
    prompt:
      `Brand category: ${brand?.category ?? "consumer product"}. Research CURRENT advertising/labeling rules in the US (FTC + FDA) and EU (EFSA + DSA) for the following marketing claims and ingredients. ` +
      `For EACH item, say whether using it in advertising is generally safe, risky, or banned, with a one-line rationale and cite a source. Items:\n${list.map((x) => `- ${x}`).join("\n")}`,
    systemKey: SYSTEM_KEY,
    brandId: job.brandId,
  });

  // 2. Claude structures the grounded research into rules
  const resp = await callClaude({
    model: "claude-sonnet-4-6",
    maxTokens: 2500,
    system: "You convert grounded regulatory research into a structured, jurisdiction-aware compliance ruleset for ad copy. Be conservative: when unsure, mark 'risky'. One rule per (subject, jurisdiction).",
    messages: [{ role: "user", content: `Grounded research:\n${grounded.slice(0, 12000)}\n\nReturn the structured ruleset via emit_compliance.` }],
    tools: [COMPLIANCE_TOOL],
    toolChoice: { type: "tool", name: "emit_compliance" },
    systemKey: SYSTEM_KEY,
    brandId: job.brandId,
  });
  const out = toolResult<{ summary?: string; rules?: Rule[]; banned_phrasings?: string[]; required_disclaimers?: string[] }>(resp, "emit_compliance");
  if (!out) throw new Error("compliance structuring returned nothing");
  const rules = (out.rules ?? []).filter((r) => r.subject && r.jurisdiction && r.verdict);

  // upsert compliance_rules (cross-ref claims the brand already runs = approved evidence)
  for (const r of rules) {
    const runs = ownClaims.has(r.subject.toLowerCase());
    await db
      .insert(schema.complianceRules)
      .values({ brandId: job.brandId, subject: r.subject, jurisdiction: r.jurisdiction, verdict: r.verdict, rationale: r.rationale ?? null, evidenceSource: r.evidence_source ?? null, brandRunsThisClaim: runs, confidence: "0.700" })
      .onConflictDoUpdate({ target: [schema.complianceRules.brandId, schema.complianceRules.subject, schema.complianceRules.jurisdiction], set: { verdict: r.verdict, rationale: r.rationale ?? null, evidenceSource: r.evidence_source ?? null, brandRunsThisClaim: runs, updatedAt: new Date() } });
  }

  await db
    .insert(schema.extractions)
    .values({
      brandId: job.brandId,
      sourceId: source.id,
      jobId: job.id,
      schemaType: "compliance",
      json: { summary: out.summary ?? `${rules.length} rules across FTC/FDA + EU/EFSA.`, rules, banned_phrasings: out.banned_phrasings ?? [], required_disclaimers: out.required_disclaimers ?? [] },
      confidence: rules.length ? "0.700" : "0.400",
      model: "gemini+claude",
    })
    .onConflictDoUpdate({ target: [schema.extractions.sourceId, schema.extractions.schemaType], set: { json: { summary: out.summary ?? `${rules.length} rules.`, rules, banned_phrasings: out.banned_phrasings ?? [], required_disclaimers: out.required_disclaimers ?? [] }, jobId: job.id, updatedAt: new Date() } });
}
