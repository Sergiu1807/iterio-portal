/* Verify product images sign + resolve. Run: npx tsx scripts/verify-product-media.ts [brandSlug] */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import * as schema from "../src/lib/db/schema";

const BUCKET = "iterio-portal-assets";

async function head(url: string): Promise<string> {
  try {
    const r = await fetch(url, { method: "GET", headers: { range: "bytes=0-0" } });
    return `${r.status} ${r.headers.get("content-type") ?? "?"}`;
  } catch (e) {
    return `fetch-error ${String(e).slice(0, 50)}`;
  }
}

async function main() {
  const slug = process.argv[2] || "lumara";
  const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dbUrl || !supaUrl || !serviceKey) throw new Error("Missing env (.env.local)");

  const sql = postgres(dbUrl, { prepare: false, max: 1 });
  const db = drizzle(sql, { schema });
  const supa = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

  const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.slug, slug)).limit(1);
  if (!brand) throw new Error(`No brand '${slug}'`);
  const products = await db.select().from(schema.products).where(eq(schema.products.brandId, brand.id));

  console.log(`\n=== ${brand.name} (${slug}) — ${products.length} products ===`);
  for (const p of products) {
    console.log(`\n• ${p.name}${p.isHero ? "  [HERO]" : ""}`);
    for (const [label, path] of [["1:1  imageUrl     ", p.imageUrl], ["9:16 videoImageUrl", p.videoImageUrl]] as const) {
      if (!path) {
        console.log(`  ${label}: (none)`);
        continue;
      }
      const { data, error } = await supa.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error || !data) {
        console.log(`  ${label}: SIGN FAILED — ${error?.message}  path=${path}`);
        continue;
      }
      console.log(`  ${label}: ${path}  ->  ${await head(data.signedUrl)}`);
    }
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
