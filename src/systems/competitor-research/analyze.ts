import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { callGemini } from "@/lib/providers/gemini";
import { downloadFromStorage } from "@/lib/storage";
import { SYSTEM_KEY } from "./ingest";

export const MAX_ATTEMPTS = 3;

/** Transient (retryable) network/provider errors must NOT burn an attempt. */
function isTransient(e: unknown): boolean {
  if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.APIConnectionTimeoutError) return true;
  if (e instanceof Anthropic.APIError) {
    const s = e.status ?? 0;
    return s === 429 || s >= 500;
  }
  return /connection error|fetch failed|econnreset|etimedout|socket|network/i.test(String((e as { message?: string })?.message ?? e));
}

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "emit_ad_analysis",
  description: "Return the structured competitor-ad analysis.",
  input_schema: {
    type: "object",
    properties: {
      creative_angle: { type: "string", description: "The core creative angle / strategic hypothesis." },
      ad_description: { type: "string", description: "1-2 sentence plain description of the ad." },
      target_persona: { type: "string" },
      core_motivation: { type: "string" },
      proof_mechanism: { type: "string", description: "How the ad earns belief (proof, demo, social, authority…)." },
      visual_hook: { type: "string" },
      spoken_hook: { type: "string", description: "Opening spoken/voiceover hook if discernible, else empty." },
      outro_offer: { type: "string", description: "Closing offer/CTA framing, else empty." },
      full_transcript: { type: "string", description: "Transcript if it's a video and discernible, else empty." },
    },
    required: ["creative_angle", "ad_description", "target_persona", "core_motivation", "proof_mechanism", "visual_hook"],
  },
};

type Analysis = {
  creative_angle: string;
  ad_description: string;
  target_persona: string;
  core_motivation: string;
  proof_mechanism: string;
  visual_hook: string;
  spoken_hook?: string;
  outro_offer?: string;
  full_transcript?: string;
};

type AdRow = typeof schema.competitorAds.$inferSelect;

async function brandBrief(brandId: string, cache: Map<string, string>): Promise<string> {
  if (cache.has(brandId)) return cache.get(brandId)!;
  const [b] = await db
    .select({ name: schema.brands.name, category: schema.brands.category })
    .from(schema.brands)
    .where(eq(schema.brands.id, brandId))
    .limit(1);
  const sections = await db
    .select({ title: schema.intelligenceSections.title, content: schema.intelligenceSections.content })
    .from(schema.intelligenceSections)
    .where(eq(schema.intelligenceSections.brandId, brandId))
    .orderBy(asc(schema.intelligenceSections.sortOrder))
    .limit(2);
  const intel = sections.map((s) => `${s.title}: ${(s.content ?? "").slice(0, 400)}`).join("\n");
  const brief = `You are analysing competitor ads on behalf of "${b?.name ?? "our brand"}"${b?.category ? ` (${b.category})` : ""}.\n${intel}`;
  cache.set(brandId, brief);
  return brief;
}

function mimeFor(path: string): string {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}
function videoMimeFor(path: string): string {
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".mov")) return "video/quicktime";
  return "video/mp4";
}
// Gemini inline request cap ~20MB (base64 inflates ~33%) → keep raw video under ~14MB,
// else fall back to poster-frame analysis.
const MAX_INLINE_VIDEO = 14 * 1024 * 1024;

async function analyzeOne(ad: AdRow, cache: Map<string, string>): Promise<void> {
  let geminiDesc = "";
  let analyzedVideo = false;
  try {
    if (ad.videoPath) {
      const buf = await downloadFromStorage(ad.videoPath);
      if (buf.length <= MAX_INLINE_VIDEO) {
        analyzedVideo = true;
        geminiDesc = await callGemini({
          prompt:
            "Analyse this competitor VIDEO ad. Describe, concretely: (1) the visual hook in the first 1–3 seconds, (2) what happens scene by scene, (3) any spoken/voiceover lines — transcribe them verbatim, (4) on-screen text, (5) the closing CTA/offer.",
          media: { base64: buf.toString("base64"), mimeType: videoMimeFor(ad.videoPath) },
          maxOutputTokens: 1600,
          systemKey: SYSTEM_KEY,
          brandId: ad.brandId,
        });
      }
    }
    if (!geminiDesc && ad.primaryThumbnail) {
      const buf = await downloadFromStorage(ad.primaryThumbnail);
      geminiDesc = await callGemini({
        prompt:
          "Analyse this competitor ad creative. In 4-6 sentences describe the visual hook, style/production, what's shown, any on-screen text, and the implied message.",
        media: { base64: buf.toString("base64"), mimeType: mimeFor(ad.primaryThumbnail) },
        systemKey: SYSTEM_KEY,
        brandId: ad.brandId,
      });
    }
  } catch {
    /* media analysis is best-effort */
  }

  const brief = await brandBrief(ad.brandId, cache);
  const userPrompt = [
    brief,
    "\n--- Competitor ad ---",
    `Advertiser: ${ad.brandPageName ?? "unknown"}`,
    `Media type: ${ad.mediaType ?? "unknown"}`,
    `Primary text: ${ad.displayPrimaryText ?? "(none)"}`,
    `Headline: ${ad.headlineTitle ?? "(none)"}`,
    `CTA: ${ad.ctaButtonType ?? "(none)"}`,
    `Destination: ${ad.destinationUrl ?? "(none)"}`,
    `${analyzedVideo ? "VIDEO analysis" : "Visual analysis"}: ${geminiDesc || "(no media available)"}`,
    analyzedVideo
      ? "\nUse the video analysis to fill spoken_hook and full_transcript with the actual voiceover/spoken lines."
      : "",
    "\nReturn the structured breakdown via the emit_ad_analysis tool.",
  ].join("\n");

  const resp = await callClaude({
    model: "claude-sonnet-4-6",
    maxTokens: 1500,
    system: "You are a senior performance-creative strategist breaking down competitor ads into reusable strategic insight.",
    messages: [{ role: "user", content: userPrompt }],
    tools: [ANALYSIS_TOOL],
    toolChoice: { type: "tool", name: "emit_ad_analysis" },
    systemKey: SYSTEM_KEY,
    brandId: ad.brandId,
  });

  const a = toolResult<Analysis>(resp, "emit_ad_analysis");
  if (!a) throw new Error("Claude returned no analysis");

  await db
    .update(schema.competitorAds)
    .set({
      creativeAngle: a.creative_angle,
      adDescription: a.ad_description,
      targetPersona: a.target_persona,
      coreMotivation: a.core_motivation,
      proofMechanism: a.proof_mechanism,
      visualHook: a.visual_hook,
      spokenHook: a.spoken_hook || null,
      outroOffer: a.outro_offer || null,
      fullTranscript: a.full_transcript || null,
      geminiDescription: geminiDesc || null,
      aiAnalysisStatus: "complete",
      aiErrorMessage: null,
      aiLastAnalyzedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.competitorAds.id, ad.id));
}

/**
 * Atomically claim a bounded batch of queued ads (FOR UPDATE SKIP LOCKED) and
 * analyse them. brandId scopes the claim to one brand (the UI tick passes it;
 * the cron leaves it global). Returns count processed.
 */
export async function analyzeQueued(opts: { brandId?: string; limit?: number } = {}): Promise<number> {
  const limit = opts.limit ?? 6;
  const brandId = opts.brandId;

  // Reconcile: any ad stranded 'queued' at/over the cap → 'failed' (otherwise the
  // claim filter skips it forever and it blocks job completion).
  await db
    .update(schema.competitorAds)
    .set({ aiAnalysisStatus: "failed", aiErrorMessage: sql`coalesce(${schema.competitorAds.aiErrorMessage}, 'Exhausted attempts')`, updatedAt: new Date() })
    .where(
      and(
        eq(schema.competitorAds.aiAnalysisStatus, "queued"),
        gte(schema.competitorAds.aiAttempts, MAX_ATTEMPTS),
        ...(brandId ? [eq(schema.competitorAds.brandId, brandId)] : [])
      )
    );

  // Atomic claim: lock & flip 'queued'→'processing' in one statement so the cron
  // and the UI tick can never grab the same rows (no double-spend, no double-increment).
  const brandFilter = brandId ? sql`AND brand_id = ${brandId}` : sql``;
  const claimedRows = await db.execute(sql`
    UPDATE competitor_ads
    SET ai_analysis_status = 'processing', ai_attempts = ai_attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM competitor_ads
      WHERE ai_analysis_status = 'queued' AND ai_attempts < ${MAX_ATTEMPTS} ${brandFilter}
      ORDER BY created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const claimedIds = (claimedRows as unknown as { id: string }[]).map((r) => r.id);

  if (claimedIds.length === 0) {
    await completeFinishedJobs(brandId);
    return 0;
  }

  // Read back claimed rows (typed, with the post-increment aiAttempts).
  const claimed = await db.select().from(schema.competitorAds).where(inArray(schema.competitorAds.id, claimedIds));

  const cache = new Map<string, string>();
  for (const ad of claimed) {
    try {
      await analyzeOne(ad, cache);
    } catch (e) {
      if (isTransient(e)) {
        // hand the attempt back — a network blip must not consume retry budget
        await db
          .update(schema.competitorAds)
          .set({ aiAnalysisStatus: "queued", aiAttempts: sql`greatest(${schema.competitorAds.aiAttempts} - 1, 0)`, aiErrorMessage: String(e).slice(0, 300), updatedAt: new Date() })
          .where(eq(schema.competitorAds.id, ad.id));
      } else {
        const exhausted = ad.aiAttempts >= MAX_ATTEMPTS; // already post-increment
        await db
          .update(schema.competitorAds)
          .set({ aiAnalysisStatus: exhausted ? "failed" : "queued", aiErrorMessage: String(e).slice(0, 300), updatedAt: new Date() })
          .where(eq(schema.competitorAds.id, ad.id));
      }
    }
  }

  await completeFinishedJobs(brandId);
  return claimed.length;
}

/** Flip 'analyzing' jobs to 'complete' once no ad is still RETRYABLE. */
async function completeFinishedJobs(brandId?: string): Promise<void> {
  const jobs = await db
    .select({ id: schema.scrapeJobs.id, stats: schema.scrapeJobs.stats, createdAt: schema.scrapeJobs.createdAt })
    .from(schema.scrapeJobs)
    .where(and(eq(schema.scrapeJobs.status, "analyzing"), ...(brandId ? [eq(schema.scrapeJobs.brandId, brandId)] : [])));

  for (const job of jobs) {
    const [{ pending }] = await db
      .select({ pending: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.competitorAds)
      .where(
        and(
          eq(schema.competitorAds.scrapeJobId, job.id),
          inArray(schema.competitorAds.aiAnalysisStatus, ["queued", "processing"]),
          lt(schema.competitorAds.aiAttempts, MAX_ATTEMPTS)
        )
      );
    if (pending > 0) continue;

    // No retryable ads left → force any leftover exhausted rows to 'failed' so the job can complete.
    await db
      .update(schema.competitorAds)
      .set({ aiAnalysisStatus: "failed", aiErrorMessage: sql`coalesce(${schema.competitorAds.aiErrorMessage}, 'Exhausted attempts')`, updatedAt: new Date() })
      .where(and(eq(schema.competitorAds.scrapeJobId, job.id), inArray(schema.competitorAds.aiAnalysisStatus, ["queued", "processing"])));

    // count only ads analysed during THIS run (re-tagged historical completes are excluded)
    const [{ analyzed }] = await db
      .select({ analyzed: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.competitorAds)
      .where(
        and(
          eq(schema.competitorAds.scrapeJobId, job.id),
          eq(schema.competitorAds.aiAnalysisStatus, "complete"),
          gte(schema.competitorAds.aiLastAnalyzedAt, job.createdAt)
        )
      );

    await db
      .update(schema.scrapeJobs)
      .set({ status: "complete", stats: { ...(job.stats ?? {}), adsAnalyzed: analyzed }, updatedAt: new Date() })
      .where(eq(schema.scrapeJobs.id, job.id));
  }
}
