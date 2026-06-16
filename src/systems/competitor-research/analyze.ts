import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { callGemini } from "@/lib/providers/gemini";
import { downloadFromStorage } from "@/lib/storage";
import { SYSTEM_KEY } from "./ingest";

const MAX_ATTEMPTS = 3;

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

/** Claim a bounded batch of queued ads and analyse them. Returns count processed. */
export async function analyzeQueued(limit = 6): Promise<number> {
  const queued = await db
    .select()
    .from(schema.competitorAds)
    .where(and(eq(schema.competitorAds.aiAnalysisStatus, "queued"), lt(schema.competitorAds.aiAttempts, MAX_ATTEMPTS)))
    .limit(limit);

  if (queued.length === 0) {
    await completeFinishedJobs();
    return 0;
  }

  const ids = queued.map((q) => q.id);
  await db
    .update(schema.competitorAds)
    .set({ aiAnalysisStatus: "processing", aiAttempts: sql`${schema.competitorAds.aiAttempts} + 1`, updatedAt: new Date() })
    .where(inArray(schema.competitorAds.id, ids));

  const cache = new Map<string, string>();
  for (const ad of queued) {
    try {
      await analyzeOne(ad, cache);
    } catch (e) {
      const willFail = ad.aiAttempts + 1 >= MAX_ATTEMPTS;
      await db
        .update(schema.competitorAds)
        .set({
          aiAnalysisStatus: willFail ? "failed" : "queued",
          aiErrorMessage: String(e).slice(0, 300),
          updatedAt: new Date(),
        })
        .where(eq(schema.competitorAds.id, ad.id));
    }
  }

  await completeFinishedJobs();
  return queued.length;
}

/** Flip 'analyzing' jobs to 'complete' once none of their ads are queued/processing. */
async function completeFinishedJobs(): Promise<void> {
  const jobs = await db
    .select({ id: schema.scrapeJobs.id })
    .from(schema.scrapeJobs)
    .where(eq(schema.scrapeJobs.status, "analyzing"));
  for (const job of jobs) {
    const [{ pending }] = await db
      .select({ pending: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.competitorAds)
      .where(and(eq(schema.competitorAds.scrapeJobId, job.id), inArray(schema.competitorAds.aiAnalysisStatus, ["queued", "processing"])));
    if (pending === 0) {
      const [{ analyzed }] = await db
        .select({ analyzed: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.competitorAds)
        .where(and(eq(schema.competitorAds.scrapeJobId, job.id), eq(schema.competitorAds.aiAnalysisStatus, "complete")));
      await db
        .update(schema.scrapeJobs)
        .set({ status: "complete", stats: { adsAnalyzed: analyzed }, updatedAt: new Date() })
        .where(eq(schema.scrapeJobs.id, job.id));
    }
  }
}
