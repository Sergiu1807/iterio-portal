// Resolve the Facebook Ad Library URL the Apify actor scrapes.
// Three inputs: paste a full Ad Library URL (most reliable), a Page ID, or a keyword.

export type ScrapeMode = "url" | "page_id" | "keyword";

export const META_ADS_ACTOR_ID = "XtaWFhbtfxyzqrFmd"; // curious_coder / Facebook Ads Library Scraper

/** True if the string is a valid Meta Ad Library URL. */
export function isAdLibraryUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (
      u.protocol === "https:" &&
      /(^|\.)facebook\.com$/.test(u.hostname) &&
      u.pathname.includes("/ads/library")
    );
  } catch {
    return false;
  }
}

/** Build the scrape URL from whichever input mode the user chose. */
export function resolveScrapeUrl(opts: { mode: ScrapeMode; query: string; country?: string }): string {
  const query = opts.query.trim();
  if (opts.mode === "url") return query; // paste-through (validate with isAdLibraryUrl first)

  const country = opts.country || "ALL";
  const base = "https://www.facebook.com/ads/library/";
  const common =
    `active_status=active&ad_type=all&country=${encodeURIComponent(country)}` +
    `&is_targeted_country=false&media_type=all` +
    `&sort_data[direction]=desc&sort_data[mode]=total_impressions`;

  if (opts.mode === "page_id") {
    return `${base}?${common}&search_type=page&view_all_page_id=${encodeURIComponent(query)}`;
  }
  return `${base}?${common}&q=${encodeURIComponent(query)}&search_type=keyword_unordered`;
}
