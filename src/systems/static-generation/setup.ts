import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getBrandById } from "@/lib/brands";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { fetchWebsiteText } from "@/lib/storage";
import { SECTION_BLUEPRINT } from "@/lib/onboarding/draft";
import { buildPlaceholderConfig } from "./placeholder-prompts";
import { SYSTEM_KEY } from "./constants";
import { brandDna, needsFill, INTEL_TOOL, INTEL_SYSTEM, PROMPTS_TOOL, authorSystemPrompt } from "./authoring";
import type { Brand } from "@/lib/types";

// ── config row ─────────────────────────────────────────────────────────────--

type ConfigRow = typeof schema.staticAdConfig.$inferSelect;

/** Ensure a config row exists for the brand (seeded with working placeholders). */
export async function ensureStaticConfig(brandId: string): Promise<ConfigRow> {
  const [existing] = await db.select().from(schema.staticAdConfig).where(eq(schema.staticAdConfig.brandId, brandId)).limit(1);
  if (existing) return existing;

  const brand = await getBrandById(brandId);
  if (!brand) throw new Error("brand not found");
  const ph = buildPlaceholderConfig({ brandName: brand.name, website: brand.website, brandColor: brand.brandColor });
  const [row] = await db
    .insert(schema.staticAdConfig)
    .values({ brandId, ...ph, status: "placeholder", isPlaceholder: true })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [again] = await db.select().from(schema.staticAdConfig).where(eq(schema.staticAdConfig.brandId, brandId)).limit(1);
  return again;
}

// ── enrich brand intelligence (non-destructive) ──────────────────────────────

async function enrichIntel(brand: Brand, siteText: string | null): Promise<void> {
  const bySectionType = new Map(brand.sections.map((s) => [s.sectionType, s]));
  const targets = SECTION_BLUEPRINT.filter((b) => {
    const ex = bySectionType.get(b.sectionType);
    return !ex || needsFill(ex.content);
  });
  if (targets.length === 0) return;

  const wanted = targets.map((t) => `- ${t.sectionType} (${t.title})`).join("\n");
  const resp = await callClaude({
    system: INTEL_SYSTEM,
    messages: [
      {
        role: "user",
        content: `${brandDna(brand, siteText)}\n\nFILL THESE SECTION TYPES (return one entry per type, using the exact sectionType id):\n${wanted}`,
      },
    ],
    maxTokens: 4000,
    timeoutMs: 120_000,
    tools: [INTEL_TOOL],
    toolChoice: { type: "tool", name: "emit_brand_intel" },
    systemKey: SYSTEM_KEY,
    brandId: brand.id,
  });

  const out = toolResult<{ sections: { sectionType: string; content: string }[] }>(resp, "emit_brand_intel");
  if (!out?.sections?.length) return;

  let nextSort = brand.sections.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1;
  for (const t of targets) {
    const produced = out.sections.find((s) => s.sectionType === t.sectionType);
    if (!produced?.content?.trim()) continue;
    const existing = bySectionType.get(t.sectionType);
    if (existing) {
      await db
        .update(schema.intelligenceSections)
        .set({ content: produced.content.trim(), updatedAt: new Date() })
        .where(eq(schema.intelligenceSections.id, existing.id));
    } else {
      await db.insert(schema.intelligenceSections).values({
        brandId: brand.id,
        title: t.title,
        sectionType: t.sectionType,
        content: produced.content.trim(),
        sortOrder: nextSort++,
      });
    }
  }
}

// ── author the two static-ad agent prompts ───────────────────────────────────

async function authorPrompts(brand: Brand, siteText: string | null): Promise<{
  agent1Prompt: string;
  agent2Prompt: string;
  briefAgent1Prompt: string;
  briefAgent2Prompt: string;
}> {
  const template = buildPlaceholderConfig({ brandName: brand.name, website: brand.website, brandColor: brand.brandColor });
  const resp = await callClaude({
    system: authorSystemPrompt(template),
    messages: [
      {
        role: "user",
        content: `Author the four prompts for this brand, grounded in its DNA:\n\n${brandDna(brand, siteText)}`,
      },
    ],
    maxTokens: 8000,
    timeoutMs: 240_000,
    tools: [PROMPTS_TOOL],
    toolChoice: { type: "tool", name: "emit_static_prompts" },
    systemKey: SYSTEM_KEY,
    brandId: brand.id,
  });

  const out = toolResult<{ agent1Prompt: string; agent2Prompt: string; briefAgent1Prompt: string; briefAgent2Prompt: string }>(resp, "emit_static_prompts");
  if (!out?.agent1Prompt || !out?.agent2Prompt) throw new Error("Agent prompt authoring returned empty output");
  return {
    agent1Prompt: out.agent1Prompt,
    agent2Prompt: out.agent2Prompt,
    briefAgent1Prompt: out.briefAgent1Prompt || template.briefAgent1Prompt,
    briefAgent2Prompt: out.briefAgent2Prompt || template.briefAgent2Prompt,
  };
}

// ── orchestrator ─────────────────────────────────────────────────────────────

/** Mark the brand's config as building (idempotent; seeds placeholders first). */
export async function beginStaticSetup(brandId: string): Promise<ConfigRow> {
  await ensureStaticConfig(brandId);
  await db
    .update(schema.staticAdConfig)
    .set({ status: "building", buildError: null, updatedAt: new Date() })
    .where(eq(schema.staticAdConfig.brandId, brandId));
  const [row] = await db.select().from(schema.staticAdConfig).where(eq(schema.staticAdConfig.brandId, brandId)).limit(1);
  return row;
}

/** Research the brand → enrich intelligence (non-destructive) → author the two
 *  agent prompts → mark ready. On failure: status='error'; placeholders remain usable. */
export async function runStaticSetup(brandId: string): Promise<void> {
  await beginStaticSetup(brandId);
  try {
    const brand = await getBrandById(brandId);
    if (!brand) throw new Error("brand not found");

    const siteText = brand.website ? await fetchWebsiteText(brand.website).catch(() => null) : null;

    // Enrich is best-effort — never block prompt authoring.
    try {
      await enrichIntel(brand, siteText);
    } catch (e) {
      console.warn("[static-setup] enrich failed", brandId, e);
    }

    // Re-read so authored prompts use the freshly-enriched intel.
    const enriched = (await getBrandById(brandId)) ?? brand;
    const prompts = await authorPrompts(enriched, siteText);

    await db
      .update(schema.staticAdConfig)
      .set({ ...prompts, status: "ready", isPlaceholder: false, buildError: null, builtAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.staticAdConfig.brandId, brandId));
  } catch (e) {
    console.warn("[static-setup] build failed", brandId, e);
    await db
      .update(schema.staticAdConfig)
      .set({ status: "error", buildError: String((e as Error)?.message ?? e).slice(0, 500), updatedAt: new Date() })
      .where(eq(schema.staticAdConfig.brandId, brandId));
  }
}
