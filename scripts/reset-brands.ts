/* Delete ALL brands (cascades to sub-resources, scrape jobs, competitor ads).
 * Usage: npx tsx scripts/reset-brands.ts */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("No DIRECT_URL / DATABASE_URL in .env.local");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const before = await sql<{ c: number }[]>`select count(*)::int as c from brands`;
    await sql`delete from brands`;
    console.log(`✓ deleted ${before[0].c} brand(s) — sub-resources, scrape jobs & competitor ads cascaded.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
