/* Print recent scrape jobs + competitor-ad pipeline state. Run: npx tsx scripts/status.ts */
import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 1 });
  try {
    const jobs = await sql`
      select id, status, mode, left(query, 60) as query, country, requested_count,
             apify_run_id, stats, cost_usd, error_message,
             to_char(created_at, 'HH24:MI:SS') as created, to_char(updated_at, 'HH24:MI:SS') as updated
      from scrape_jobs order by created_at desc limit 5`;
    console.log("=== recent scrape_jobs ===");
    for (const j of jobs) {
      console.log(
        `• ${j.status.toUpperCase().padEnd(10)} ${j.mode}/${j.country}  "${j.query}"  ` +
        `run=${j.apify_run_id ?? "-"}  stats=${JSON.stringify(j.stats)}  $${j.cost_usd}  ${j.created}→${j.updated}` +
        (j.error_message ? `  ERR: ${j.error_message}` : "")
      );
    }
    const counts = await sql`select ai_analysis_status as s, count(*)::int as c from competitor_ads group by ai_analysis_status`;
    console.log("\n=== competitor_ads by analysis status ===");
    if (!counts.length) console.log("(no ads yet)");
    for (const c of counts) console.log(`• ${c.s}: ${c.c}`);

    const media = await sql`
      select count(*)::int as total,
             count(video_path)::int as with_video,
             count(primary_thumbnail)::int as with_thumb
      from competitor_ads`;
    console.log(`\n=== media === total=${media[0].total} thumbs=${media[0].with_thumb} videos=${media[0].with_video}`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
