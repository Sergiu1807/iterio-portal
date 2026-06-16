import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { callClaude, textOf } from "@/lib/providers/claude";
import { imageBase64FromPath } from "@/lib/storage";
import { SYSTEM_KEY } from "./constants";

/** Build a Claude vision block from an image stored in our bucket. */
export async function imageBlock(path: string): Promise<Anthropic.ImageBlockParam> {
  const { base64, mediaType } = await imageBase64FromPath(path);
  return { type: "image", source: { type: "base64", media_type: mediaType as Anthropic.Base64ImageSource["media_type"], data: base64 } };
}

function stripFences(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) return t.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  return t;
}

/**
 * Agent 1 (vision): analyse a reference ad image → structured JSON "format brief".
 * Returns the raw JSON string (tolerant: passes the text through even if it isn't
 * strictly parseable, so Agent 2 can still use it).
 */
export async function analyzeReference(referencePath: string, agent1Prompt: string, brandId: string): Promise<string> {
  const resp = await callClaude({
    system: agent1Prompt,
    messages: [
      {
        role: "user",
        content: [await imageBlock(referencePath), { type: "text", text: "Analyse this advertisement image and output the structured JSON description." }],
      },
    ],
    maxTokens: 4000,
    systemKey: SYSTEM_KEY,
    brandId,
  });
  return stripFences(textOf(resp));
}

/** Agent 1 (brief mode): turn a written brief (+ optional logo) into the same JSON. */
export async function analyzeBrief(briefText: string, agent1Prompt: string, brandId: string, logoPath?: string | null): Promise<string> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (logoPath) content.push(await imageBlock(logoPath));
  content.push({ type: "text", text: `CREATIVE BRIEF:\n${briefText}\n\nOutput the structured JSON plan.` });
  const resp = await callClaude({
    system: agent1Prompt,
    messages: [{ role: "user", content }],
    maxTokens: 4000,
    systemKey: SYSTEM_KEY,
    brandId,
  });
  return stripFences(textOf(resp));
}

export type ProductContext = { name: string; imagePath?: string | null; category?: string | null; keyBenefits?: string | null };

/**
 * Agent 2 (composer): FORMAT BRIEF JSON + product + copy + aspect ratio → one
 * richly detailed image-generation prompt for Nano Banana.
 */
export async function composePrompt(opts: {
  analysisJson: string;
  agent2Prompt: string;
  aspectRatio: string;
  brandId: string;
  product?: ProductContext | null;
  adCopy?: string | null;
}): Promise<string> {
  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: `FORMAT BRIEF (JSON):\n${opts.analysisJson}` }];

  if (opts.product) {
    const facts = [opts.product.name, opts.product.category, opts.product.keyBenefits].filter(Boolean).join(" · ");
    content.push({ type: "text", text: `SELECTED PRODUCT: ${facts}. Its image is attached as the source of truth for its appearance.` });
    if (opts.product.imagePath) content.push(await imageBlock(opts.product.imagePath));
  } else {
    content.push({ type: "text", text: "NO PRODUCT — compose a brand-statement ad with no product depicted." });
  }

  if (opts.adCopy?.trim()) content.push({ type: "text", text: `USER COPY (use this on the canvas):\n${opts.adCopy.trim()}` });
  content.push({ type: "text", text: `REQUIRED ASPECT RATIO: ${opts.aspectRatio}` });

  const resp = await callClaude({
    system: opts.agent2Prompt,
    messages: [{ role: "user", content }],
    maxTokens: 2000,
    systemKey: SYSTEM_KEY,
    brandId: opts.brandId,
  });
  return textOf(resp).trim();
}
