/* Seed the LUMARA demo brand + upload its product images to Supabase Storage.
 * Idempotent (deletes any existing 'lumara' brand first). Run: npx tsx scripts/seed-lumara.ts */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as schema from "../src/lib/db/schema";

const BUCKET = "iterio-portal-assets";

async function main() {
  const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dbUrl || !supaUrl || !serviceKey) throw new Error("Missing env (.env.local)");

  const sql = postgres(dbUrl, { prepare: false, max: 1 });
  const db = drizzle(sql, { schema });
  const supa = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

  // --- upload product images ---
  const uploads: { path: string; file: string }[] = [
    { path: "brands/lumara/products/collagen-1x1.png", file: join(homedir(), "Desktop", "lumara.png") },
    { path: "brands/lumara/products/collagen-9x16.png", file: join(homedir(), "Desktop", "lumara-portrait.png") },
  ];
  for (const u of uploads) {
    const body = readFileSync(u.file);
    const { error } = await supa.storage.from(BUCKET).upload(u.path, body, { contentType: "image/png", upsert: true });
    if (error) throw new Error(`upload ${u.path}: ${error.message}`);
    console.log(`✓ uploaded ${u.path} (${(body.length / 1024 / 1024).toFixed(1)} MB)`);
  }
  const img1x1 = uploads[0].path;
  const img9x16 = uploads[1].path;

  // --- reset existing lumara ---
  await db.delete(schema.brands).where(eq(schema.brands.slug, "lumara"));

  // --- brand ---
  const [brand] = await db
    .insert(schema.brands)
    .values({
      name: "LUMARA",
      slug: "lumara",
      website: "https://lumara.co",
      category: "Collagen & Beauty Supplements",
      primaryMarket: "United States",
      currency: "USD",
      tagline: "Radiance from within.",
      vibe: "Warm · editorial · quietly luxurious",
      brandColor: "#C46A43",
      palette: [
        { hex: "#C46A43", role: "primary" },
        { hex: "#F4EBDD", role: "surface" },
        { hex: "#C98B86", role: "accent" },
        { hex: "#2E2422", role: "ink" },
      ],
      cluster: "Beauty & Wellness",
      status: "Active",
      onboardingSource: "wizard",
      enabledSystems: {
        "brief-generation": true,
        "static-generation": true,
        "video-generation": true,
        "competitor-research": true,
      },
      storagePrefix: "lumara",
    })
    .returning();
  const brandId = brand.id;

  // --- intelligence sections ---
  const sections = [
    { sectionType: "identity", title: "Core Identity & Mission", content:
      "LUMARA is a premium collagen brand that reframes collagen from a fitness supplement into a daily beauty ritual. Where the category sells grams and gym performance, LUMARA sells the quiet confidence of better skin, hair and nails — *radiance from within*. The product is best-in-class grass-fed bovine collagen peptides; the brand is the difference: warm, editorial, and designed to live on a vanity, not in a gym bag." },
    { sectionType: "audience", title: "Target Customer Profile", content:
      "Women 32–55 who already invest in skincare and view their routine as self-care. They read ingredient labels, distrust hype, and pay a premium for design, transparency and sustainability. They are switching INTO collagen from serums and supplements — not from protein powder. Secondary: gifting (daughters→mothers) and the 'fewer, better things' minimalist." },
    { sectionType: "products", title: "Key Products & Services", content:
      "**Daily Collagen Peptides** (hero) — 20g grass-fed, pasture-raised bovine collagen peptides per serving, unflavored, 9.3 oz (265 g) in a plastic-free paperboard canister. Supports skin, hair, nails + joints. Also: a **Refill Pouch** subscription (90% less packaging) and **Collagen Glow Capsules** for on-the-go." },
    { sectionType: "usps", title: "Unique Selling Propositions", content:
      "1) 20g clinically-relevant dose of grass-fed, pasture-raised collagen. 2) Single ingredient, fully transparent — no fillers, no proprietary blends. 3) Plastic-free, refillable packaging. 4) A beauty-ritual experience (taste-free, dissolves clean) rather than a gym supplement." },
    { sectionType: "voice", title: "Brand Voice & Tone", content:
      "Warm, confident, editorial — like a trusted friend with great taste. Calm and uncluttered; never shouty, never clinical, no exclamation-mark hype. Leads with feeling and ritual, backs it with quiet credibility. Example phrases: \"Your two-minute morning ritual.\" · \"Skin you can feel good about — inside and out.\" · \"One scoop. No compromise.\"" },
    { sectionType: "visual", title: "Visual Direction", content:
      "Warm terracotta (#C46A43) + soft cream (#F4EBDD), espresso ink, muted-rose accent. Matte paperboard packaging, single-line botanical motifs, natural light, real skin texture (no retouching), generous negative space. Editorial, tactile, sun-warmed — the opposite of clinical blue." },
    { sectionType: "competitors", title: "Competitor Landscape", content:
      "Vital Proteins (category leader — clinical, sporty, blue, unisex) is the primary foil; LUMARA wins on warmth, design and the beauty-ritual position. Ancient Nutrition (multi-source,健康-forward), Further Food, and Sports Research compete on price/dose. LUMARA's wedge: premium beauty positioning + sustainable packaging for a design-led female buyer." },
    { sectionType: "constraints", title: "Creative Constraints & Guardrails", content:
      "Dietary supplement — NOT a drug. No disease-treatment or anti-aging 'cure' claims; structure/function language only (\"supports skin elasticity\"), always with the DSHEA disclaimer where required. No before/after medical imagery implying treatment. Substantiate '20g' and 'grass-fed/pasture-raised'. FTC: disclose paid/affiliate partnerships. Keep claims honest and on-brand." },
  ];
  await db.insert(schema.intelligenceSections).values(
    sections.map((s, i) => ({ brandId, title: s.title, sectionType: s.sectionType, content: s.content, sortOrder: i }))
  );

  // --- products (hero carries the 1:1 + 9:16 images) ---
  await db.insert(schema.products).values([
    {
      brandId,
      name: "Daily Collagen Peptides",
      category: "Collagen Powder",
      keyBenefits: "20g grass-fed collagen · skin, hair, nails + joints · unflavored · plastic-free canister",
      price: "$38",
      productUrl: "https://lumara.co/products/daily-collagen-peptides",
      imageUrl: img1x1,
      videoImageUrl: img9x16,
      isHero: true,
    },
    {
      brandId,
      name: "Refill Pouch (Subscribe)",
      category: "Refill",
      keyBenefits: "90% less packaging · auto-renews monthly · same 20g grass-fed peptides",
      price: "$32/mo",
    },
  ]);

  // --- personas ---
  await db.insert(schema.personas).values([
    {
      brandId,
      name: "The Skincare Maximalist",
      demographics: "F, 38–52, HHI $120k+, urban/suburban US",
      psychographics: "Owns a 6-step routine; follows derms on Instagram; believes beauty is inside-out",
      painPoints: "Skincare alone has plateaued; collagen options feel gym-y or cheap",
      desires: "A premium, credible collagen that fits her ritual and her bathroom shelf",
    },
    {
      brandId,
      name: "The Wellness Minimalist",
      demographics: "F, 30–42, design/creative fields",
      psychographics: "Fewer, better things; reads ingredient lists; values sustainability",
      painPoints: "Overwhelmed by hype and plastic tubs of powder",
      desires: "One clean, beautiful daily ritual she can trust and feel good about",
    },
  ]);

  // --- usps ---
  await db.insert(schema.usps).values([
    { brandId, text: "20g grass-fed, pasture-raised collagen — a clinically-relevant dose", category: "Efficacy", isPrimary: true },
    { brandId, text: "Single ingredient, fully transparent — no fillers or proprietary blends", category: "Trust", isPrimary: true },
    { brandId, text: "Plastic-free, refillable packaging", category: "Sustainability" },
    { brandId, text: "A taste-free beauty ritual, not a gym supplement", category: "Brand" },
  ]);

  // --- competitors (real — keyword-scrapable in Competitor Research) ---
  await db.insert(schema.competitors).values([
    { brandId, name: "Vital Proteins", websiteUrl: "https://www.vitalproteins.com", instagramHandle: "@vitalproteins", metaSearchTerms: "Vital Proteins", type: "Direct" },
    { brandId, name: "Ancient Nutrition", websiteUrl: "https://ancientnutrition.com", instagramHandle: "@ancientnutrition", metaSearchTerms: "Ancient Nutrition collagen", type: "Direct" },
    { brandId, name: "Further Food", websiteUrl: "https://www.furtherfood.com", instagramHandle: "@furtherfood", metaSearchTerms: "Further Food collagen", type: "Direct" },
    { brandId, name: "Sports Research", websiteUrl: "https://sportsresearch.com", instagramHandle: "@sportsresearch", metaSearchTerms: "Sports Research collagen", type: "Direct" },
  ]);

  console.log(`\n✓ Seeded LUMARA (${brandId}) — 8 sections · 2 products · 2 personas · 4 USPs · 4 competitors.`);
  await sql.end();
}

main().catch((e) => {
  console.error("✗ seed failed:", e);
  process.exit(1);
});
