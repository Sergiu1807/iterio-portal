// Build a Facebook Ad Library URL the Apify actor scrapes — page-id or keyword mode.
// Mirrors the n8n "Create Ad Library URL" node 1:1.

export type ScrapeMode = "page_id" | "keyword";

export function buildMetaAdLibraryUrl(opts: {
  mode: ScrapeMode;
  query: string; // page id OR keyword
  country?: string; // e.g. "US", "ALL"
}): string {
  const country = opts.country || "ALL";
  const base = "https://www.facebook.com/ads/library/";
  const common =
    `active_status=active&ad_type=all&country=${encodeURIComponent(country)}` +
    `&is_targeted_country=false&media_type=all` +
    `&sort_data[direction]=desc&sort_data[mode]=total_impressions`;

  if (opts.mode === "page_id") {
    return `${base}?${common}&search_type=page&view_all_page_id=${encodeURIComponent(opts.query)}`;
  }
  return `${base}?${common}&q=${encodeURIComponent(opts.query)}&search_type=keyword_unordered`;
}

export const META_ADS_ACTOR_ID = "XtaWFhbtfxyzqrFmd"; // curious_coder / Facebook Ads Library Scraper
