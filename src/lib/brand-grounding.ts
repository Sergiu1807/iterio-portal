import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getApprovedBrandIntelligenceMeta } from "@/systems/brand-foundation/contract";
import type { B3, B3ComplianceRule, B3Persona, B3WinnerPattern } from "@/systems/brand-foundation/b3-schema";
import { getBrandById } from "@/lib/brands";
import { brandDna } from "@/systems/static-generation/authoring";

/**
 * THE canonical brand-grounding accessor for generation systems.
 * B3-FIRST: reads the approved Brand Intelligence (the versioned, evidence-backed
 * profile) and formats a rich grounding string + exposes the structured fields a
 * generator needs (compliance ruleset, personas, winner patterns).
 * FLAT-FALLBACK: if there's no approved B3 yet, degrades to the legacy flat brand
 * record (same shape the existing generators read) so nothing ever blocks.
 */
export type BrandGrounding = {
  source: "b3" | "flat" | "none";
  brandName: string;
  category?: string;
  version: number | null; // B3 version when source === "b3"
  text: string; // formatted markdown grounding, ready to inject into a prompt
  b3: B3 | null;
  compliance: { rules: B3ComplianceRule[]; banned_phrasings: string[]; required_disclaimers: string[] };
  personas: B3Persona[];
  winnerPatterns: { own: B3WinnerPattern[]; competitor: B3WinnerPattern[]; category: B3WinnerPattern[] };
};

const list = (items: (string | undefined)[] | undefined, prefix = "- "): string =>
  (items ?? []).map((x) => (x ?? "").trim()).filter(Boolean).map((x) => `${prefix}${x}`).join("\n");

/** Format an approved B3 into a depth-rich grounding string for strategic prompts. */
function formatB3(b3: B3, brandName: string): string {
  const p = b3.positioning;
  const personaBlock = (b3.personas ?? [])
    .slice(0, 5)
    .map((per) => {
      const lines = [
        `• ${per.name ?? "Persona"}${per.demographics ? ` — ${per.demographics}` : ""}`,
        per.psychographics ? `  psychographics: ${per.psychographics}` : "",
        per.pains?.length ? `  pains: ${per.pains.slice(0, 6).join("; ")}` : "",
        per.desires?.length ? `  desires: ${per.desires.slice(0, 6).join("; ")}` : "",
        per.objections?.length ? `  objections: ${per.objections.slice(0, 6).join("; ")}` : "",
        per.their_words?.length ? `  their words (verbatim VOC): ${per.their_words.slice(0, 8).map((w) => `"${w}"`).join("; ")}` : "",
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n");
  const proof = (b3.proof_mechanisms ?? []).map((m) => `- ${m.type ? `[${m.type}] ` : ""}${m.detail ?? ""}${m.evidence ? ` (evidence: ${m.evidence})` : ""}`).join("\n");
  const products = (b3.products ?? []).slice(0, 12).map((pr) => `- ${pr.name ?? "Product"}${pr.is_hero ? " [HERO]" : ""}${pr.price ? ` · ${pr.price}` : ""}${pr.claims_made?.length ? ` — claims: ${pr.claims_made.slice(0, 4).join("; ")}` : ""}`).join("\n");
  const winners = (group: B3WinnerPattern[] | undefined, label: string): string => {
    const rows = (group ?? []).slice(0, 8).map((w) => `- [${label}] ${w.angle ?? ""}${w.hook ? ` — hook: "${w.hook}"` : ""}${w.why_it_wins ? ` (${w.why_it_wins})` : ""}`);
    return rows.join("\n");
  };
  const v = b3.voice_profile;

  return [
    `BRAND: ${brandName}${b3.brand_snapshot?.category ? ` (${b3.brand_snapshot.category})` : ""}`,
    b3.brand_snapshot?.one_liner ? `ONE-LINER: ${b3.brand_snapshot.one_liner}` : "",
    b3.brand_snapshot?.mission ? `MISSION: ${b3.brand_snapshot.mission}` : "",
    p ? `POSITIONING: ${p.statement ?? ""}${p.category_belief ? `\n  category belief: ${p.category_belief}` : ""}${p.enemy ? `\n  enemy: ${p.enemy}` : ""}${p.price_tier ? `\n  price tier: ${p.price_tier}` : ""}${p.differentiators?.length ? `\n  differentiators:\n${list(p.differentiators, "    - ")}` : ""}` : "",
    b3.emotional_triggers?.length ? `EMOTIONAL TRIGGERS:\n${list(b3.emotional_triggers)}` : "",
    personaBlock ? `PERSONAS:\n${personaBlock}` : "",
    proof ? `PROOF MECHANISMS:\n${proof}` : "",
    v ? `VOICE: ${v.tone ?? ""}${v.sentence_style ? ` · ${v.sentence_style}` : ""}${v.vocabulary?.length ? `\n  vocabulary: ${v.vocabulary.slice(0, 12).join(", ")}` : ""}${v.banned_words?.length ? `\n  banned words: ${v.banned_words.join(", ")}` : ""}` : "",
    products ? `PRODUCTS:\n${products}` : "",
    (b3.winner_patterns?.own?.length || b3.winner_patterns?.competitor?.length || b3.winner_patterns?.category?.length)
      ? `WINNING PATTERNS:\n${[winners(b3.winner_patterns?.own, "own"), winners(b3.winner_patterns?.competitor, "competitor"), winners(b3.winner_patterns?.category, "category")].filter(Boolean).join("\n")}`
      : "",
    (b3.gap_analysis?.unmet_desires?.length || b3.gap_analysis?.whitespace_angles?.length)
      ? `GAP ANALYSIS:\n${b3.gap_analysis?.unmet_desires?.length ? `  unmet desires:\n${list(b3.gap_analysis.unmet_desires, "    - ")}` : ""}${b3.gap_analysis?.whitespace_angles?.length ? `\n  whitespace angles:\n${list(b3.gap_analysis.whitespace_angles, "    - ")}` : ""}`
      : "",
    b3.compliance?.banned_phrasings?.length ? `COMPLIANCE — BANNED PHRASINGS (never use):\n${list(b3.compliance.banned_phrasings)}` : "",
    b3.compliance?.required_disclaimers?.length ? `COMPLIANCE — REQUIRED DISCLAIMERS:\n${list(b3.compliance.required_disclaimers)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12_000);
}

/** A compact brand-voice block for prompt stages with a tight token budget (e.g. the
 *  video crafter). Always carries positioning + voice + banned phrasings. */
export function compactBrandContext(g: BrandGrounding, maxChars = 1800): string {
  if (g.source === "none") return "";
  if (g.b3) {
    const b = g.b3;
    const out = [
      `BRAND: ${g.brandName}${g.category ? ` (${g.category})` : ""}`,
      b.positioning?.statement ? `POSITIONING: ${b.positioning.statement}` : "",
      b.voice_profile?.tone ? `VOICE: ${b.voice_profile.tone}${b.voice_profile.sentence_style ? ` · ${b.voice_profile.sentence_style}` : ""}` : "",
      b.emotional_triggers?.length ? `EMOTIONAL TRIGGERS: ${b.emotional_triggers.slice(0, 6).join("; ")}` : "",
      b.voice_profile?.banned_words?.length ? `AVOID WORDS: ${b.voice_profile.banned_words.join(", ")}` : "",
      g.compliance.banned_phrasings.length ? `NEVER SAY (compliance): ${g.compliance.banned_phrasings.join("; ")}` : "",
      g.compliance.required_disclaimers.length ? `REQUIRED DISCLAIMERS: ${g.compliance.required_disclaimers.join("; ")}` : "",
    ].filter(Boolean).join("\n");
    return out.slice(0, maxChars);
  }
  return g.text.slice(0, maxChars);
}

/** Build brand grounding: approved B3 if present, else the legacy flat record. */
export async function buildBrandGrounding(brandId: string): Promise<BrandGrounding> {
  const meta = await getApprovedBrandIntelligenceMeta(brandId);
  if (meta) {
    const { b3, version } = meta;
    const brandName = b3.brand_snapshot?.name || "this brand";
    return {
      source: "b3",
      brandName,
      category: b3.brand_snapshot?.category,
      version,
      text: formatB3(b3, brandName),
      b3,
      compliance: {
        rules: b3.compliance?.rules ?? [],
        banned_phrasings: b3.compliance?.banned_phrasings ?? [],
        required_disclaimers: b3.compliance?.required_disclaimers ?? [],
      },
      personas: b3.personas ?? [],
      winnerPatterns: { own: b3.winner_patterns?.own ?? [], competitor: b3.winner_patterns?.competitor ?? [], category: b3.winner_patterns?.category ?? [] },
    };
  }

  const brand = await getBrandById(brandId);
  if (!brand) {
    return { source: "none", brandName: "this brand", version: null, text: "", b3: null, compliance: { rules: [], banned_phrasings: [], required_disclaimers: [] }, personas: [], winnerPatterns: { own: [], competitor: [], category: [] } };
  }
  // Flat fallback — reuse the existing brandDna formatter; derive lite personas.
  const personas: B3Persona[] = brand.personas.map((p) => ({
    name: p.name,
    demographics: p.demographics,
    psychographics: p.psychographics,
    pains: p.painPoints ? [p.painPoints] : [],
    desires: p.desires ? [p.desires] : [],
  }));
  return {
    source: "flat",
    brandName: brand.name,
    category: brand.category,
    version: null,
    text: brandDna(brand, null),
    b3: null,
    compliance: { rules: [], banned_phrasings: [], required_disclaimers: [] },
    personas,
    winnerPatterns: { own: [], competitor: [], category: [] },
  };
}

/** The brand's on-brand creative inputs (for the Compliance/QA Gate's on-brand check):
 *  palette/fonts/visual-do-dont from B3 creative_dna + storage keys from brand_assets,
 *  flat-fallback to brands.palette/fonts + product image paths. */
export type BrandCreativeAssets = {
  source: "b3" | "flat" | "none";
  palette: { hex: string; role?: string }[];
  fonts: { display?: string; body?: string };
  visualStyle?: string;
  do: string[];
  dont: string[];
  logoKey: string | null;
  productShotKeys: string[];
  referenceKeys: string[]; // past winning creatives
};

export async function getBrandCreativeAssets(brandId: string): Promise<BrandCreativeAssets> {
  const [meta, assets] = await Promise.all([
    getApprovedBrandIntelligenceMeta(brandId),
    db.select({ type: schema.brandAssets.type, key: schema.brandAssets.storageKey }).from(schema.brandAssets).where(eq(schema.brandAssets.brandId, brandId)),
  ]);
  const ofType = (t: string) => assets.filter((a) => a.type === t).map((a) => a.key).filter(Boolean);
  const logoFromAssets = ofType("logo")[0] ?? null;
  const productShots = ofType("product_photo");
  const winners = ofType("winning_creative");

  if (meta) {
    const cd = meta.b3.creative_dna ?? {};
    return {
      source: "b3",
      palette: cd.palette ?? [],
      fonts: cd.fonts ?? {},
      visualStyle: cd.visual_style,
      do: cd.do ?? [],
      dont: cd.dont ?? [],
      logoKey: cd.logo_key ?? logoFromAssets,
      productShotKeys: productShots.length ? productShots : (cd.reference_asset_keys ?? []),
      referenceKeys: winners.length ? winners : (cd.reference_asset_keys ?? []),
    };
  }
  const brand = await getBrandById(brandId);
  if (!brand) return { source: "none", palette: [], fonts: {}, do: [], dont: [], logoKey: logoFromAssets, productShotKeys: productShots, referenceKeys: winners };
  return {
    source: "flat",
    palette: brand.palette ?? [],
    fonts: brand.fonts ?? {},
    do: [],
    dont: [],
    logoKey: logoFromAssets,
    productShotKeys: productShots.length ? productShots : (brand.products.map((p) => p.imageUrl).filter((k): k is string => !!k)),
    referenceKeys: winners,
  };
}
