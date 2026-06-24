import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { scrubPII, pick, runApifyVocScrape, thinVoc, type PrepResult } from "./voc-common";

type SourceRow = typeof schema.brandSources.$inferSelect;
type JobRow = typeof schema.researchJobs.$inferSelect;

// apify/instagram-scraper — official, 40K users, 99.7%. A single profile scrape returns
// posts with the brand's captions (its own voice) AND latestComments (audience VOC).
const IG_ACTOR = "apify~instagram-scraper";

function prepareSocialEvidence(items: Record<string, unknown>[], _brandName: string): PrepResult {
  const captions: string[] = [];
  const comments: string[] = [];
  for (const p of items) {
    const cap = String(pick(p, ["caption", "text", "title"]) ?? "").trim();
    if (cap.length > 4) captions.push(cap);
    const lc = (p.latestComments ?? p.comments ?? []) as unknown;
    if (Array.isArray(lc)) {
      for (const c of lc) {
        const ct = typeof c === "string" ? c : String((c as Record<string, unknown>)?.text ?? (c as Record<string, unknown>)?.comment ?? "");
        if (ct.trim().length > 2) comments.push(ct.trim());
      }
    }
  }
  const count = captions.length + comments.length;
  if (!count) return { evidence: "", count: 0, rawMeta: {} };
  const capBlock = captions.slice(0, 30).map((c, i) => `#${i + 1} ${c}`).join("\n");
  const comBlock = comments.slice(0, 120).map((c, i) => `#${i + 1} ${c}`).join("\n");
  const evidence =
    `BRAND INSTAGRAM CAPTIONS — the brand's own voice (${captions.length}):\n${scrubPII(capBlock).slice(0, 7000)}\n\n` +
    `AUDIENCE COMMENTS — voice-of-customer (${comments.length}):\n${scrubPII(comBlock).slice(0, 9000)}`;
  return {
    evidence,
    count,
    rawMeta: { platform: "instagram", captions: captions.length, comments: comments.length, sampleCaptions: captions.slice(0, 8), sampleComments: comments.slice(0, 15) },
    extra: { voice_samples: captions.slice(0, 12) }, // surfaced to synthesis → voice_profile
  };
}

/** Social VOC + brand voice. Scrapes the brand's Instagram profile (source.url) for posts. */
export async function runSocialJob(job: JobRow, source: SourceRow): Promise<void> {
  const url = source.url ?? "";
  const [brand] = await db.select({ name: schema.brands.name }).from(schema.brands).where(eq(schema.brands.id, job.brandId)).limit(1);
  const brandName = brand?.name ?? "";
  if (!url) { await thinVoc(job, source, "No Instagram profile URL provided."); return; }

  const handled = await runApifyVocScrape(job, source, brandName, {
    actorId: IG_ACTOR,
    buildInput: (s, _b, max) => ({ directUrls: [s.url], resultsType: "posts", resultsLimit: Math.min(40, Math.max(10, max)), addParentData: false }),
    prepareEvidence: prepareSocialEvidence,
    label: "Instagram",
    kind: "post",
    floor: 0.8,
    defaultMax: 30,
  });
  if (!handled) await thinVoc(job, source, "No Instagram posts found (or Apify unavailable).");
}
