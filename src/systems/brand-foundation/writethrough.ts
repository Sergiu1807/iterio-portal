import "server-only";
import { getBrandById, updateBrandRecord } from "@/lib/brands";
import type { Brand, BrandIntelSection, Competitor, PaletteColor, Persona, Product, Usp } from "@/lib/types";
import type { B3 } from "./b3-schema";

const bullets = (arr?: (string | undefined)[]) => (arr ?? []).filter(Boolean).map((s) => `- ${s}`).join("\n");
const sec = (sectionType: string, title: string, content: string, sortOrder: number): BrandIntelSection => ({
  id: "",
  title,
  sectionType,
  content: content.trim(),
  sortOrder,
});

/**
 * Project an approved B3 into the legacy flat brand model (intelligence_sections,
 * products, personas, usps, competitors + brand scalars) by reusing
 * updateBrandRecord (scalar + per-array replace). This keeps every EXISTING
 * downstream system (analyze/remake/static/video) working unchanged — they read
 * the projection while new code reads the B3 via getApprovedBrandIntelligence.
 */
export async function projectB3ToLegacy(brandId: string, b3: B3): Promise<void> {
  const sections: BrandIntelSection[] = [];
  let order = 0;

  // identity ← brand_snapshot + positioning
  const snap = b3.brand_snapshot ?? {};
  const pos = b3.positioning ?? {};
  const identity = [
    snap.one_liner ? `**${snap.one_liner}**` : "",
    snap.mission ? `Mission: ${snap.mission}` : "",
    snap.founder_story ? `Founder story: ${snap.founder_story}` : "",
    pos.statement ? `Positioning: ${pos.statement}` : "",
    pos.differentiators?.length ? `Differentiators:\n${bullets(pos.differentiators)}` : "",
    pos.category_belief ? `Category belief: ${pos.category_belief}` : "",
    pos.enemy ? `Enemy: ${pos.enemy}` : "",
    pos.price_tier ? `Price tier: ${pos.price_tier}` : "",
  ].filter(Boolean).join("\n\n");
  if (identity) sections.push(sec("identity", "Identity & Positioning", identity, order++));

  // audience ← personas
  const personaRows: Persona[] = [];
  const audienceMd: string[] = [];
  for (const p of b3.personas ?? []) {
    personaRows.push({
      id: "",
      name: p.name ?? "Persona",
      demographics: p.demographics || undefined,
      psychographics: [p.psychographics, p.their_words?.length ? `Their words: ${p.their_words.join("; ")}` : ""].filter(Boolean).join(" — ") || undefined,
      painPoints: (p.pains ?? []).join("; ") || undefined,
      desires: (p.desires ?? []).join("; ") || undefined,
    });
    audienceMd.push(
      [
        `### ${p.name ?? "Persona"}`,
        p.demographics,
        p.pains?.length ? `Pains: ${p.pains.join("; ")}` : "",
        p.desires?.length ? `Desires: ${p.desires.join("; ")}` : "",
        p.objections?.length ? `Objections: ${p.objections.join("; ")}` : "",
        p.their_words?.length ? `Their words: ${p.their_words.map((w) => `"${w}"`).join(" ")}` : "",
      ].filter(Boolean).join("\n")
    );
  }
  if (audienceMd.length) sections.push(sec("audience", "Audience & Personas", audienceMd.join("\n\n"), order++));

  // products ← products (merge image/url fields from existing same-name products so we never wipe uploaded media)
  const existing = await getBrandById(brandId);
  const existingByName = new Map((existing?.products ?? []).map((p) => [p.name.trim().toLowerCase(), p]));
  const productRows: Product[] = (b3.products ?? []).map((p) => {
    const prior = existingByName.get((p.name ?? "").trim().toLowerCase());
    return {
      id: "",
      name: p.name ?? "Product",
      category: prior?.category,
      keyBenefits: [p.claims_made?.join("; "), p.ingredients?.length ? `Ingredients: ${p.ingredients.join(", ")}` : "", p.dosage ? `Dosage: ${p.dosage}` : ""].filter(Boolean).join(" — ") || prior?.keyBenefits || undefined,
      price: p.price ?? prior?.price,
      productUrl: prior?.productUrl,
      imageUrl: prior?.imageUrl,
      videoImageUrl: prior?.videoImageUrl,
      isHero: p.is_hero ?? prior?.isHero ?? false,
    };
  });
  const productsMd = (b3.products ?? [])
    .map((p) => `- **${p.name ?? "Product"}**${p.is_hero ? " (hero)" : ""}${p.format ? ` · ${p.format}` : ""}${p.price ? ` · ${p.price}` : ""}${p.claims_made?.length ? `\n  Claims: ${p.claims_made.join("; ")}` : ""}`)
    .join("\n");
  if (productsMd) sections.push(sec("products", "Products", productsMd, order++));

  // usps ← proof_mechanisms + offers
  const uspRows: Usp[] = [];
  (b3.proof_mechanisms ?? []).forEach((m, i) => { if (m.detail) uspRows.push({ id: "", text: m.detail, category: m.type, isPrimary: i === 0 }); });
  (b3.offers ?? []).forEach((o) => { const t = [o.name, o.pricing, o.promo].filter(Boolean).join(" — "); if (t) uspRows.push({ id: "", text: t, category: "offer", isPrimary: false }); });
  const uspMd = [
    ...(b3.proof_mechanisms ?? []).map((m) => (m.detail ? `- ${m.detail}${m.evidence ? ` (${m.evidence})` : ""}` : "")),
    ...(b3.offers ?? []).map((o) => { const t = [o.name, o.pricing, o.promo].filter(Boolean).join(" — "); return t ? `- ${t}` : ""; }),
  ].filter(Boolean).join("\n");
  if (uspMd) sections.push(sec("usps", "Proof & Offers", uspMd, order++));

  // voice ← voice_profile
  const vp = b3.voice_profile ?? {};
  const voice = [
    vp.tone ? `Tone: ${vp.tone}` : "",
    vp.sentence_style ? `Style: ${vp.sentence_style}` : "",
    vp.vocabulary?.length ? `Vocabulary: ${vp.vocabulary.join(", ")}` : "",
    vp.banned_words?.length ? `Avoid: ${vp.banned_words.join(", ")}` : "",
    vp.examples?.length ? `Examples:\n${bullets(vp.examples)}` : "",
  ].filter(Boolean).join("\n\n");
  if (voice) sections.push(sec("voice", "Voice", voice, order++));

  // visual ← creative_dna
  const cd = b3.creative_dna ?? {};
  const visual = [
    cd.visual_style ? `Style: ${cd.visual_style}` : "",
    cd.do?.length ? `Do:\n${bullets(cd.do)}` : "",
    cd.dont?.length ? `Don't:\n${bullets(cd.dont)}` : "",
  ].filter(Boolean).join("\n\n");
  if (visual) sections.push(sec("visual", "Visual / Creative DNA", visual, order++));

  // competitors ← winner_patterns.competitor
  const compMd = (b3.winner_patterns?.competitor ?? []).map((w) => `- ${w.angle ?? w.hook ?? "Pattern"}${w.why_it_wins ? ` — ${w.why_it_wins}` : ""}`).join("\n");
  if (compMd) sections.push(sec("competitors", "Competitor Winner Patterns", compMd, order++));

  // constraints ← compliance + gap_analysis  (static-generation/setup reads sectionType "constraints")
  const cmp = b3.compliance ?? {};
  const constraints = [
    cmp.summary ?? "",
    cmp.banned_phrasings?.length ? `Banned phrasings:\n${bullets(cmp.banned_phrasings)}` : "",
    cmp.required_disclaimers?.length ? `Required disclaimers:\n${bullets(cmp.required_disclaimers)}` : "",
    (cmp.rules ?? []).length ? `Rules:\n${(cmp.rules ?? []).map((r) => `- [${r.verdict}] ${r.subject} (${r.jurisdiction})${r.rationale ? ` — ${r.rationale}` : ""}`).join("\n")}` : "",
    b3.gap_analysis?.whitespace_angles?.length ? `Whitespace angles:\n${bullets(b3.gap_analysis.whitespace_angles)}` : "",
  ].filter(Boolean).join("\n\n");
  if (constraints) sections.push(sec("constraints", "Compliance & Constraints", constraints, order++));

  const patch: Partial<Brand> = { sections };
  if (productRows.length) patch.products = productRows;
  if (personaRows.length) patch.personas = personaRows;
  if (uspRows.length) patch.usps = uspRows;
  const palette = (cd.palette ?? []).filter((c) => c.hex).map((c) => ({ hex: c.hex, role: c.role ?? "" })) as PaletteColor[];
  if (palette.length) { patch.palette = palette; patch.brandColor = palette[0].hex; }
  if (cd.fonts && (cd.fonts.display || cd.fonts.body)) patch.fonts = cd.fonts;
  // (competitors intentionally not array-replaced in P1 — competitor-research owns that table)

  await updateBrandRecord(brandId, patch);
}
