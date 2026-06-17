/* Reproduce the Characters upload backend ops to isolate the failure.
 * Run: npx tsx scripts/probe-video-characters.ts [brandSlug] */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import * as schema from "../src/lib/db/schema";

const BUCKET = "iterio-portal-assets";
// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function main() {
  const slug = process.argv[2] || "lumara";
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const db = drizzle(sql, { schema });
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.slug, slug)).limit(1);
  if (!brand) throw new Error(`no brand '${slug}'`);
  console.log("brand:", brand.name, brand.id);

  const path = `brands/${slug}/video-characters/probe-${Date.now()}.png`;

  // 1) storage upload (what uploadToStorage does)
  const up = await supa.storage.from(BUCKET).upload(path, PNG, { contentType: "image/png", upsert: true });
  console.log("storage upload:", up.error ? `FAILED — ${up.error.message}` : "OK");
  if (up.error) throw up.error;

  // 2) insert row (what the route does)
  let rowId: string | null = null;
  try {
    const [row] = await db.insert(schema.videoCharacters).values({ brandId: brand.id, name: "Probe", imagePath: path }).returning();
    rowId = row.id;
    console.log("db insert video_characters:", "OK", row.id);
  } catch (e) {
    console.log("db insert video_characters: FAILED —", String((e as Error)?.message ?? e));
    throw e;
  }

  // 3) sign + read back
  const signed = await supa.storage.from(BUCKET).createSignedUrl(path, 3600);
  console.log("sign URL:", signed.error ? `FAILED — ${signed.error.message}` : "OK");
  const list = await db.select().from(schema.videoCharacters).where(eq(schema.videoCharacters.brandId, brand.id));
  console.log("rows for brand:", list.length);

  // cleanup
  if (rowId) await db.delete(schema.videoCharacters).where(eq(schema.videoCharacters.id, rowId));
  await supa.storage.from(BUCKET).remove([path]);
  console.log("cleanup: done");
  console.log("\n✅ Backend upload path WORKS. If the UI fails, it's the deploy or client, not the backend.");
  await sql.end();
}

main().catch((e) => {
  console.error("\n❌ Backend repro FAILED:", e?.message ?? e);
  process.exit(1);
});
