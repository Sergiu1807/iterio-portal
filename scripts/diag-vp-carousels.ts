/* Diagnose why competitor carousels show "media unavailable".
 * Run: npx tsx scripts/diag-vp-carousels.ts [advertiserLike]   (default: vital) */
import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

const like = `%${(process.argv[2] ?? "vital").toLowerCase()}%`;
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  const rows = await sql<
    {
      ad_archive_id: string;
      brand_page_name: string | null;
      media_type: string | null;
      is_dco: boolean;
      dedup_count: number;
      media_capture_failed: boolean;
      media_capture_attempts: number;
      media_cards: string[];
      source_media_urls: { thumbnailUrl?: string; videoUrl?: string; carouselImageUrls?: string[] } | null;
      ai_analysis_status: string;
      headline_title: string | null;
      display_primary_text: string | null;
      display_domain: string | null;
    }[]
  >`
    SELECT ad_archive_id, brand_page_name, media_type, is_dco, dedup_count,
           media_capture_failed, media_capture_attempts, media_cards,
           source_media_urls, ai_analysis_status, headline_title,
           display_primary_text, display_domain
    FROM competitor_ads
    WHERE lower(coalesce(brand_page_name,'')) LIKE ${like}
    ORDER BY media_type, ad_archive_id`;

  const carousels = rows.filter((r) => r.media_type === "carousel");
  console.log(`\n${rows.length} ads for "${like}" — ${carousels.length} carousels\n`);

  let emptySource = 0;
  let populatedButFailed = 0;
  let dpaLike = 0;
  let ok = 0;

  for (const r of carousels) {
    const srcCards = r.source_media_urls?.carouselImageUrls ?? [];
    const saved = r.media_cards?.length ?? 0;
    const headline = (r.headline_title ?? "").slice(0, 40);
    const isTemplated = /\{\{|\bproduct\.name\b/i.test(`${r.headline_title ?? ""} ${r.display_primary_text ?? ""}`);
    if (isTemplated) dpaLike++;
    let verdict: string;
    if (srcCards.length === 0) {
      emptySource++;
      verdict = "NO source image URLs (normalization/DPA)";
    } else if (saved === 0) {
      populatedButFailed++;
      verdict = `had ${srcCards.length} src URLs but saved 0 (FETCH/STORE failed)`;
    } else {
      ok++;
      verdict = `OK (${saved}/${srcCards.length} saved)`;
    }
    console.log(
      [
        `• ${r.ad_archive_id}`,
        `dco=${r.is_dco}`,
        `tmpl=${isTemplated}`,
        `srcCards=${srcCards.length}`,
        `saved=${saved}`,
        `capFailed=${r.media_capture_failed}`,
        `attempts=${r.media_capture_attempts}`,
        `domain=${r.display_domain ?? "-"}`,
        `→ ${verdict}`,
      ].join("  ")
    );
    // show a couple of sample source URLs so we can see what Apify returned
    if (srcCards.length) console.log(`    sample: ${srcCards.slice(0, 2).join("  |  ")}`);
  }

  console.log(`\nSUMMARY for carousels:`);
  console.log(`  NO source URLs (DPA/normalization): ${emptySource}`);
  console.log(`  populated but fetch/store failed:   ${populatedButFailed}`);
  console.log(`  fully OK:                            ${ok}`);
  console.log(`  templated ({{...}} / product.name): ${dpaLike}`);

  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
