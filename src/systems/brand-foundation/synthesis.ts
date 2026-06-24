import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, textOf } from "@/lib/providers/claude";
import type { B3 } from "./b3-schema";
import { blankB3 } from "./b3-schema";
import { createDraft } from "./versioning";

const SYSTEM_KEY = "brand-onboarding";

function parseJsonObject(text: string): Record<string, unknown> | null {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

const B3_SHAPE = `{
  "brand_snapshot": { "name", "category", "one_liner", "mission", "founder_story" },
  "positioning": { "statement", "differentiators": [], "category_belief", "enemy", "price_tier" },
  "personas": [{ "name", "demographics", "psychographics", "pains": [], "desires": [], "objections": [], "their_words": [] }],
  "emotional_triggers": [],
  "proof_mechanisms": [{ "type", "detail", "evidence" }],
  "offers": [{ "name", "pricing", "subscription", "promo" }],
  "products": [{ "name", "is_hero", "ingredients": [], "dosage", "format", "price", "certifications": [], "claims_made": [] }],
  "compliance": { "summary", "banned_phrasings": [], "required_disclaimers": [] },
  "creative_dna": { "visual_style", "do": [], "dont": [] },
  "voice_profile": { "tone", "sentence_style", "vocabulary": [], "banned_words": [], "examples": [] },
  "winner_patterns": { "own": [{ "angle", "hook", "why_it_wins" }], "competitor": [{ "angle", "hook", "why_it_wins" }] },
  "gap_analysis": { "unmet_desires": [], "whitespace_angles": [] },
  "channels": [{ "channel", "notes", "what_works" }],
  "meta": { "confidence_scores": { "<section>": 0.0 }, "gaps": [{ "field", "severity", "reason" }] }
}`;

/**
 * Aggregate every research extraction + the competitor/meta winner signals into a
 * Brand Intelligence (B3) draft. Best-effort + idempotent (always a new draft).
 */
export async function synthesizeB3(brandId: string): Promise<void> {
  const [brand] = await db.select({ name: schema.brands.name, category: schema.brands.category }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);

  const exts = await db.select().from(schema.extractions).where(eq(schema.extractions.brandId, brandId));

  // winner signals from the (reused) competitor pipeline
  const concepts = await db
    .select({ id: schema.conceptClusters.id, competitorId: schema.conceptClusters.competitorId, advertiser: schema.conceptClusters.advertiser, score: schema.conceptClusters.winnerScore })
    .from(schema.conceptClusters)
    .where(eq(schema.conceptClusters.brandId, brandId))
    .orderBy(desc(schema.conceptClusters.winnerScore))
    .limit(20);
  const conceptIds = concepts.map((c) => c.id);
  const banks = conceptIds.length
    ? await db.select().from(schema.angleBankEntries).where(inArray(schema.angleBankEntries.conceptId, conceptIds))
    : [];
  const bankByConcept = new Map(banks.map((b) => [b.conceptId, b]));
  const winners = concepts.map((c) => {
    const b = bankByConcept.get(c.id);
    return { own: !c.competitorId, advertiser: c.advertiser, angle: b?.angle, hook: b?.hook, mechanism: b?.mechanism, why: b?.winnerTier, score: c.score };
  });

  const evidence = {
    brand: { name: brand?.name ?? "", category: brand?.category ?? "" },
    extractions: exts.map((e) => ({ schema: e.schemaType, confidence: e.confidence, data: e.json })),
    winners_own: winners.filter((w) => w.own).slice(0, 8),
    winners_competitor: winners.filter((w) => !w.own).slice(0, 10),
  };

  const resp = await callClaude({
    model: "claude-opus-4-8",
    maxTokens: 8000,
    temperature: 0.4,
    timeoutMs: 180_000,
    system:
      "You are a senior brand strategist. Think step by step, then synthesize the supplied research evidence into a Brand Intelligence (B3) object. " +
      "Output ONLY a single JSON object — no prose, no markdown fences. Match this shape (all keys optional, omit what the evidence can't support):\n" +
      B3_SHAPE +
      "\nRules: ground every field in the evidence; copy customer wording verbatim into personas.their_words; NEVER invent facts. In meta.confidence_scores give a 0..1 score per section; in meta.gaps list sections where evidence was thin or missing as {field, severity (low|medium|high), reason}.",
    messages: [{ role: "user", content: `Research evidence:\n${JSON.stringify(evidence).slice(0, 60_000)}\n\nReturn the B3 JSON.` }],
    systemKey: SYSTEM_KEY,
    brandId,
  });

  const parsed = parseJsonObject(textOf(resp));
  const base = blankB3({ name: brand?.name, category: brand?.category ?? undefined });
  const b3: B3 = { ...base, ...(parsed ?? {}) } as B3;
  // ensure snapshot name/category + a meta block
  b3.brand_snapshot = { ...(b3.brand_snapshot ?? {}), name: b3.brand_snapshot?.name || brand?.name || "", category: b3.brand_snapshot?.category || brand?.category || "" };
  b3.meta = {
    ...(b3.meta ?? {}),
    confidence_scores: b3.meta?.confidence_scores ?? {},
    gaps: b3.meta?.gaps ?? (parsed ? [] : [{ field: "all", severity: "high", reason: "Synthesis could not parse a structured B3 — review and fill manually." }]),
    generated_at: new Date().toISOString(),
  };

  await createDraft(brandId, b3);
}
