import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { callGemini } from "@/lib/providers/gemini";
import { buildBrandGrounding, getBrandCreativeAssets } from "@/lib/brand-grounding";
import { fetchExternalMedia, imageBase64FromPath, extFromContentType } from "@/lib/storage";
import { SYSTEM_KEY, CLAUDE_MODEL, GEN_TIMEOUT_MS } from "./constants";
import { buildVisionPrompt, parseVisionJson, CLAIM_SAFETY_TOOL, CLAIM_SYSTEM, buildClaimMessage, buildScorecard, type ClaimScores, type VisionScores } from "./prompt";

type ReviewRow = typeof schema.gateReviews.$inferSelect;

export type StartGateOpts = { brandId: string; sourceSystem?: string; sourceId?: string | null; assetPath?: string | null; copyText?: string | null };

/** Resolve the creative being gated → (assetPath, copyText) from a static/video generation. */
async function resolveSource(opts: StartGateOpts): Promise<{ sourceSystem: string; sourceId: string | null; assetPath: string | null; copyText: string | null }> {
  if (opts.sourceSystem === "static" && opts.sourceId) {
    const [g] = await db.select({ imagePath: schema.staticAdGenerations.imagePath, adCopy: schema.staticAdGenerations.adCopy }).from(schema.staticAdGenerations).where(and(eq(schema.staticAdGenerations.id, opts.sourceId), eq(schema.staticAdGenerations.brandId, opts.brandId))).limit(1);
    return { sourceSystem: "static", sourceId: opts.sourceId, assetPath: g?.imagePath ?? null, copyText: opts.copyText ?? g?.adCopy ?? null };
  }
  // external / ad-hoc (e.g. a pasted image URL) — gate whatever's handed in
  return { sourceSystem: opts.sourceSystem || "external", sourceId: opts.sourceId ?? null, assetPath: opts.assetPath ?? null, copyText: opts.copyText ?? null };
}

export async function startGateReview(opts: StartGateOpts): Promise<{ reviewId: string }> {
  const src = await resolveSource(opts);
  if (!src.assetPath) throw new Error("no creative asset to gate (missing image)");
  const grounding = await buildBrandGrounding(opts.brandId);
  const [row] = await db
    .insert(schema.gateReviews)
    .values({ brandId: opts.brandId, sourceSystem: src.sourceSystem, sourceId: src.sourceId, assetPath: src.assetPath, copyText: src.copyText, status: "pending", groundingSource: grounding.source, b3Version: grounding.version })
    .returning({ id: schema.gateReviews.id });
  return { reviewId: row.id };
}

async function loadImage(assetPath: string): Promise<{ base64: string; mimeType: string } | null> {
  if (/^https?:\/\//.test(assetPath)) {
    const m = await fetchExternalMedia(assetPath, { maxBytes: 8 * 1024 * 1024, timeoutMs: 15_000 });
    if (m && m.contentType.startsWith("image/")) return { base64: m.buffer.toString("base64"), mimeType: `image/${extFromContentType(m.contentType)}` };
    return null;
  }
  try { const { base64, mediaType } = await imageBase64FromPath(assetPath); return { base64, mimeType: mediaType }; } catch { return null; }
}

export type GatedResult = { criteria: { key: string; label: string; score: number; pass: boolean; note: string }[]; overallPass: boolean; onImageText: string; groundingSource: string; b3Version: number | null };

/** Run the AI scorecard: Gemini Vision (4 visual criteria + text) + Claude claim-safety (2). */
export async function runGateReview(review: ReviewRow): Promise<GatedResult> {
  if (!review.assetPath) throw new Error("review has no asset");
  const creative = await loadImage(review.assetPath);
  if (!creative) throw new Error("could not load the creative image");

  const [grounding, assets] = await Promise.all([buildBrandGrounding(review.brandId), getBrandCreativeAssets(review.brandId)]);
  const media = [{ base64: creative.base64, mimeType: creative.mimeType }];
  if (assets.logoKey) { const logo = await loadImage(assets.logoKey); if (logo) media.push(logo); }

  // 1) Gemini Vision → on_brand / not_ai / hook / clarity + on_image_text
  let vision: VisionScores = {};
  let visionOk = false;
  try {
    const out = await callGemini({ prompt: buildVisionPrompt(assets, grounding.brandName), media, maxOutputTokens: 1200, systemKey: SYSTEM_KEY, brandId: review.brandId });
    vision = parseVisionJson(out);
    visionOk = typeof vision.on_brand?.score === "number" || typeof vision.clarity?.score === "number";
  } catch (e) {
    console.warn("[gate] vision failed", String(e).slice(0, 120));
  }
  const onImageText = vision.on_image_text ?? "";

  // 2) Claude claim-safety + angle integrity (text-only, grounded on the B3 ruleset)
  const inheritedFlag = (review.complianceInherited as { flag?: string } | null)?.flag ?? null;
  const resp = await callClaude({
    model: CLAUDE_MODEL,
    maxTokens: 1500,
    timeoutMs: GEN_TIMEOUT_MS,
    system: CLAIM_SYSTEM,
    messages: [{ role: "user", content: buildClaimMessage(grounding, onImageText, review.copyText, inheritedFlag) }],
    tools: [CLAIM_SAFETY_TOOL],
    toolChoice: { type: "tool", name: "emit_claim_safety" },
    systemKey: SYSTEM_KEY,
    brandId: review.brandId,
  });
  const claim = toolResult<ClaimScores>(resp, "emit_claim_safety") ?? {};

  const { criteria, overallPass, onImageText: t } = buildScorecard(vision, claim, grounding.compliance.banned_phrasings, visionOk);
  return { criteria, overallPass, onImageText: t, groundingSource: grounding.source, b3Version: grounding.version };
}
