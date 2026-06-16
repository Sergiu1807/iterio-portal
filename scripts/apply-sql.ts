/* Apply a raw .sql file (multi-statement, $$-quoted) against DIRECT_URL.
 * Usage: npx tsx scripts/apply-sql.ts [path]   (default: supabase/post-migrate.sql) */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { readFileSync } from "node:fs";

async function main() {
  const file = process.argv[2] || "supabase/post-migrate.sql";
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("No DIRECT_URL / DATABASE_URL in .env.local");

  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const content = readFileSync(file, "utf8");
    await sql.unsafe(content).simple(); // simple protocol → multiple statements + dollar-quoting
    console.log(`✓ applied ${file}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("✗ failed:", e);
  process.exit(1);
});
