import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { scrubPII, pick, TITLE_KEYS, runApifyVocScrape, thinVoc, type PrepResult } from "./voc-common";

type SourceRow = typeof schema.brandSources.$inferSelect;
type JobRow = typeof schema.researchJobs.$inferSelect;

// trudax/reddit-scraper-lite — 29K users, 4.6★. Search the brand across Reddit for
// unfiltered community VOC (posts + comments).
const REDDIT_ACTOR = "trudax~reddit-scraper-lite";
const BODY_KEYS = ["body", "text", "content", "selftext", "comment", "commentBody"];

function prepareRedditEvidence(items: Record<string, unknown>[], brandName: string): PrepResult {
  const rows = items
    .map((it) => {
      const title = String(pick(it, TITLE_KEYS) ?? "").trim();
      const body = String(pick(it, BODY_KEYS) ?? "").trim();
      const text = [title, body].filter(Boolean).join(" — ").trim();
      if (text.length < 8) return null;
      const sub = String(pick(it, ["communityName", "subreddit", "community", "parsedCommunityName"]) ?? "").trim().replace(/^\/?r\//, "");
      const up = pick(it, ["upVotes", "score", "numberOfVotes", "upvotes"]);
      const meta = [sub ? `r/${sub}` : "", up != null ? `▲${up}` : ""].filter(Boolean).join(" ");
      return { text, meta };
    })
    .filter((x): x is { text: string; meta: string } => !!x)
    .slice(0, 120);
  if (!rows.length) return { evidence: "", count: 0, rawMeta: {} };
  const block = rows.map((x, i) => `#${i + 1} ${x.meta ? `[${x.meta}] ` : ""}${x.text}`).join("\n");
  const evidence = `REAL REDDIT DISCUSSIONS mentioning ${brandName} (${rows.length} posts/comments — unfiltered community voice):\n${scrubPII(block).slice(0, 16000)}`;
  return { evidence, count: rows.length, rawMeta: { platform: "reddit", count: rows.length, sample: rows.slice(0, 15) } };
}

/** Reddit community VOC. Searches the brand (source.handle, default brand name) across Reddit. */
export async function runRedditJob(job: JobRow, source: SourceRow): Promise<void> {
  const [brand] = await db.select({ name: schema.brands.name }).from(schema.brands).where(eq(schema.brands.id, job.brandId)).limit(1);
  const brandName = brand?.name ?? "";
  const term = (source.handle?.trim() || brandName).trim();
  if (!term) { await thinVoc(job, source, "No Reddit search term (brand name empty)."); return; }

  const handled = await runApifyVocScrape(job, source, brandName, {
    actorId: REDDIT_ACTOR,
    buildInput: (_s, _b, max) => ({
      searches: [term],
      searchPosts: true,
      searchComments: true,
      sort: "relevance",
      time: "all",
      maxItems: max,
      skipUserPosts: true,
      skipCommunity: true,
      includeNSFW: false,
      includeMediaLinks: false,
    }),
    prepareEvidence: prepareRedditEvidence,
    label: "Reddit",
    kind: "post",
    floor: 0.8,
    defaultMax: 80,
  });
  if (!handled) await thinVoc(job, source, `No Reddit discussions found for "${term}" (or Apify unavailable).`);
}
