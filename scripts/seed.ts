/* Seed the demo brands into Postgres. Idempotent (skips brands whose slug
 * already exists). Run: npm run seed  (requires .env.local DATABASE_URL/DIRECT_URL).
 * Standalone connection — avoids importing server-only / @/-aliased modules. */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";
import { MOCK_BRANDS } from "../src/lib/mock-brands";

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL / DIRECT_URL in .env.local");

  const client = postgres(url, { prepare: false });
  const db = drizzle(client, { schema });

  let created = 0;
  for (const b of MOCK_BRANDS) {
    const [row] = await db
      .insert(schema.brands)
      .values({
        name: b.name,
        slug: b.slug,
        website: b.website ?? null,
        category: b.category ?? null,
        primaryMarket: b.primaryMarket ?? null,
        currency: b.currency ?? null,
        tagline: b.tagline ?? null,
        vibe: b.vibe ?? null,
        brandColor: b.brandColor,
        palette: b.palette,
        cluster: b.cluster ?? null,
        status: b.status,
        onboardingSource: b.onboardingSource ?? null,
        enabledSystems: b.enabledSystems,
        storagePrefix: b.slug,
      })
      .onConflictDoNothing({ target: schema.brands.slug })
      .returning();

    if (!row) {
      console.log(`• ${b.name} (${b.slug}) already exists — skipped`);
      continue;
    }
    created++;

    if (b.sections.length)
      await db.insert(schema.intelligenceSections).values(
        b.sections.map((s, i) => ({ brandId: row.id, title: s.title, sectionType: s.sectionType, content: s.content, sortOrder: s.sortOrder ?? i }))
      );
    if (b.products.length)
      await db.insert(schema.products).values(b.products.map((p) => ({ brandId: row.id, name: p.name, category: p.category ?? null, keyBenefits: p.keyBenefits ?? null, price: p.price ?? null, productUrl: p.productUrl ?? null, isHero: p.isHero ?? false })));
    if (b.personas.length)
      await db.insert(schema.personas).values(b.personas.map((p) => ({ brandId: row.id, name: p.name, demographics: p.demographics ?? null, psychographics: p.psychographics ?? null, painPoints: p.painPoints ?? null, desires: p.desires ?? null })));
    if (b.usps.length)
      await db.insert(schema.usps).values(b.usps.map((u) => ({ brandId: row.id, text: u.text, category: u.category ?? null, isPrimary: u.isPrimary ?? false })));
    if (b.competitors.length)
      await db.insert(schema.competitors).values(b.competitors.map((c) => ({ brandId: row.id, name: c.name, websiteUrl: c.websiteUrl ?? null, instagramHandle: c.instagramHandle ?? null, tiktokHandle: c.tiktokHandle ?? null, type: c.type ?? null })));

    console.log(`✓ seeded ${b.name}`);
  }

  console.log(`\nDone. ${created} brand(s) created.`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
