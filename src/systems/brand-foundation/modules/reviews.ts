import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { tavilySearch } from "@/lib/providers/tavily";
import { fetchWebsiteText } from "@/lib/storage";
import { SYSTEM_KEY, scrubPII, normalizeReview, ratingDistribution, extractVoc, thinVoc, runApifyVocScrape, type NormReview, type VocScrapeConfig } from "./voc-common";

type SourceRow = typeof schema.brandSources.$inferSelect;
type JobRow = typeof schema.researchJobs.$inferSelect;

const SITE_LABEL: Record<string, string> = { amazon: "Amazon", trustpilot: "Trustpilot", google_reviews: "Google" };

// Per-site Apify review actor (chosen by usage + success rate). One input builder each;
// output is normalised defensively (schemas vary), so they share one prepareEvidence.
const REVIEW_ACTORS: Record<string, Pick<VocScrapeConfig, "actorId" | "buildInput">> = {
  trustpilot: {
    actorId: "6q70QEFc2Zk0ObldU", // automation-lab/trustpilot — 97% success, $0.25/1K
    buildInput: (_s, _b, max) => ({ companyUrls: [_s.url], maxReviewsPerCompany: max, sort: "recency", languages: ["en"], includeCompanyInfo: true }),
  },
  amazon: {
    actorId: "gFtgG31RZJYlphznm", // web_wanderer/amazon-reviews-extractor — 4.7★, 96% success
    buildInput: (s, _b, max) => ({ products: [s.url], limit: Math.min(10, Math.max(2, Math.ceil(max / 10))), sort: "recent", region: String((s.config as { region?: string } | null)?.region ?? "amazon.com"), language: "all", personal_data: false }),
  },
  google_reviews: {
    actorId: "Xb8osYTtOjlsgI6k9", // compass/Google-Maps-Reviews-Scraper — 44K users, 99% success
    buildInput: (s, _b, max) => ({ startUrls: [{ url: s.url }], maxReviews: max, reviewsSort: "newest", language: "en", personalData: false }),
  },
};

function prepareReviewEvidence(label: string) {
  return (items: Record<string, unknown>[], _brandName: string) => {
    const reviews = items.map(normalizeReview).filter((r): r is NormReview => !!r).slice(0, 300);
    if (!reviews.length) return { evidence: "", count: 0, rawMeta: {} };
    const distro = ratingDistribution(reviews);
    const block = reviews.map((r, i) => `#${i + 1} ${r.rating ? `(${r.rating}★) ` : ""}${r.title ? `${r.title}: ` : ""}${r.text}`).join("\n");
    const evidence = `REAL ${label.toUpperCase()} REVIEWS (${reviews.length} scraped${distro ? `; ${distro}` : ""}):\n${scrubPII(block).slice(0, 16000)}`;
    return { evidence, count: reviews.length, ratingSummary: distro, rawMeta: { site: label, distribution: distro, sample: reviews.slice(0, 20) } };
  };
}

/**
 * Reviews/VOC module. Preferred: a dedicated Apify review actor scrapes REAL verbatim
 * reviews (async — polled across passes). Fallback: Tavily + page fetch (degrades
 * gracefully when Apify is unconfigured / fails / returns nothing).
 */
export async function runReviewsJob(job: JobRow, source: SourceRow): Promise<void> {
  const url = source.url ?? "";
  const site = SITE_LABEL[source.type] ?? source.type;
  const [brand] = await db.select({ name: schema.brands.name }).from(schema.brands).where(eq(schema.brands.id, job.brandId)).limit(1);
  const brandName = brand?.name ?? "";

  const actor = REVIEW_ACTORS[source.type];
  if (actor && url) {
    const handled = await runApifyVocScrape(job, source, brandName, { ...actor, prepareEvidence: prepareReviewEvidence(site), label: site, kind: "review", floor: 0.85, defaultMax: 60 });
    if (handled) return; // (throws WaitError while the async scrape is still running)
  }

  // ── Tavily + page-fetch fallback ──
  const pageText = url ? scrubPII((await fetchWebsiteText(url, { maxChars: 12000 })) ?? "") : "";
  let tav: { answer: string; results: { title: string; url: string; content: string }[] } = { answer: "", results: [] };
  try {
    tav = await tavilySearch({
      query: `${brandName} customer reviews on ${site} — what people praise, complaints, before and after, who buys it`,
      searchDepth: "advanced",
      includeAnswer: true,
      maxResults: 10,
      systemKey: SYSTEM_KEY,
      brandId: job.brandId,
    });
  } catch (e) {
    console.warn("[reviews] tavily unavailable:", String(e).slice(0, 100));
  }
  if (!pageText && !tav.answer && !tav.results.length) {
    await thinVoc(job, source, `No accessible review content for ${site} (scrape + page + web research unavailable).`);
    return;
  }
  const tavText = scrubPII([tav.answer, ...tav.results.map((r) => `${r.title}: ${r.content}`)].filter(Boolean).join("\n"));
  await db
    .insert(schema.rawArtifacts)
    .values({ brandId: job.brandId, jobId: job.id, kind: "review", externalId: url || `${source.type}:${source.id}`, meta: { site, url, source: "web", text: pageText.slice(0, 14000), tavilyAnswer: tav.answer, sources: tav.results.map((r) => ({ title: r.title, url: r.url })) } })
    .onConflictDoNothing();
  const evidence = [pageText ? `REVIEW PAGE (${site}):\n${pageText.slice(0, 9000)}` : "", `\nWEB RESEARCH:\n${tavText.slice(0, 6000)}`].join("\n");
  await extractVoc(job, source, site, brandName, evidence);
}
