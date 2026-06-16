import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 1 });
  try {
    const rows = await sql`
      select ad_archive_id, ai_analysis_status as status, ai_attempts as attempts,
             media_type, (primary_thumbnail is not null) as has_thumb, (video_path is not null) as has_video,
             left(coalesce(ai_error_message,''), 160) as err
      from competitor_ads
      where ai_analysis_status <> 'complete'
      order by ai_analysis_status`;
    console.log("non-complete ads:");
    for (const r of rows) console.log(JSON.stringify(r));

    const noThumb = await sql`select count(*)::int c from competitor_ads where primary_thumbnail is null`;
    const byType = await sql`select media_type, count(*)::int c, count(primary_thumbnail)::int thumbs, count(video_path)::int vids from competitor_ads group by media_type`;
    console.log("\nno-thumbnail count:", noThumb[0].c);
    console.log("by media_type:", JSON.stringify(byType));
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
