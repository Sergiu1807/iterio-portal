import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { brandDna } from "./authoring";
import { imageBlock } from "./pipeline";
import { SYSTEM_KEY } from "./constants";
import type { Brand } from "@/lib/types";

export type BrandDnaResult = {
  visualLanguageModifier: string;
  hexPalette: string[];
  fonts: { heading?: string | null; body?: string | null };
  voiceKeywords: string[];
  emotionalKeywords: string[];
  proofPoints: string[];
  dos: string[];
  donts: string[];
};

const DNA_TOOL: Anthropic.Tool = {
  name: "emit_brand_dna",
  description: "Return the brand's visual + verbal DNA for image-prompt assembly.",
  input_schema: {
    type: "object",
    properties: {
      visualLanguageModifier: {
        type: "string",
        description:
          'A single 50–75 word prose paragraph beginning exactly "Shoot in the <Brand> visual language:" — include the brand\'s exact hex colours, font/typography character, photography direction, and mood. Prependable to any image prompt.',
      },
      hexPalette: { type: "array", items: { type: "string" }, description: "The brand's real hex colours, dominant first." },
      fonts: {
        type: "object",
        properties: { heading: { type: "string" }, body: { type: "string" } },
      },
      voiceKeywords: { type: "array", items: { type: "string" }, description: "4–6 brand-voice adjectives." },
      emotionalKeywords: { type: "array", items: { type: "string" }, description: "5–8 emotional-register keywords." },
      proofPoints: { type: "array", items: { type: "string" }, description: "Concrete, REAL stats/ratings/guarantees from the brand — never invented." },
      dos: { type: "array", items: { type: "string" }, description: "Copy/design do's specific to this brand." },
      donts: { type: "array", items: { type: "string" }, description: "Copy/design don'ts specific to this brand." },
    },
    required: ["visualLanguageModifier", "hexPalette", "voiceKeywords", "emotionalKeywords"],
  },
};

/** Reverse-engineer the brand's visual + verbal DNA into the slots the Agent 2
 *  master template needs. Grounded in website research + brand intel + palette. */
export async function researchBrandDna(brand: Brand, siteText: string | null, logoPath?: string | null): Promise<BrandDnaResult> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (logoPath) content.push(await imageBlock(logoPath));
  content.push({ type: "text", text: `Reverse-engineer the visual + verbal DNA for this brand. The palette hexes below are CONFIRMED — use them exactly; do not invent alternatives. Only invent proof points if the brand data clearly supports them, otherwise leave proofPoints empty.\n\n${brandDna(brand, siteText)}` });

  const resp = await callClaude({
    system:
      "You are a senior brand strategist reverse-engineering a brand's visual and verbal identity to drive AI image-generation prompts. Be precise and concrete: exact hex colours (prefer the confirmed palette), real font/photography character, a tight emotional register, and the brand's true voice. The visualLanguageModifier must be 50–75 words and begin exactly with \"Shoot in the <Brand> visual language:\". Never fabricate stats, ratings, or social proof.",
    messages: [{ role: "user", content }],
    maxTokens: 2500,
    timeoutMs: 120_000,
    tools: [DNA_TOOL],
    toolChoice: { type: "tool", name: "emit_brand_dna" },
    systemKey: SYSTEM_KEY,
    brandId: brand.id,
  });

  const out = toolResult<BrandDnaResult>(resp, "emit_brand_dna");
  if (!out?.visualLanguageModifier) throw new Error("Brand DNA research returned empty output");
  return {
    visualLanguageModifier: out.visualLanguageModifier,
    hexPalette: out.hexPalette ?? [],
    fonts: out.fonts ?? {},
    voiceKeywords: out.voiceKeywords ?? [],
    emotionalKeywords: out.emotionalKeywords ?? [],
    proofPoints: out.proofPoints ?? [],
    dos: out.dos ?? [],
    donts: out.donts ?? [],
  };
}

const CATALOG_TOOL: Anthropic.Tool = {
  name: "emit_catalog",
  description: "Return one dense, render-ready descriptive paragraph per product.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            paragraph: { type: "string", description: "One dense paragraph: physical form, materials, colours (hex where visible), label/logo placement, finish, distinctive features. Render-ready; no placeholders/brackets." },
          },
          required: ["name", "paragraph"],
        },
      },
    },
    required: ["items"],
  },
};

function sanitize(p: string): string {
  return p
    .replace(/[​-‍﻿]/g, "")
    .replace(/\[[^\]]*\]/g, "") // strip [bracket] placeholder tokens (image models render them literally)
    .replace(/©\s*\d{4}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dense per-product description paragraphs, used VERBATIM in the Agent 2 catalog. */
export async function studyProducts(brand: Brand): Promise<{ name: string; paragraph: string }[]> {
  const products = brand.products.filter((p) => !/^(test|placeholder|demo|sample|untitled|example)\b/i.test(p.name));
  if (!products.length) return [];

  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: `Study these ${brand.name} products. For EACH, write one dense, render-ready paragraph an image model can use verbatim. Begin each paragraph immediately — no preamble. Products:` },
  ];
  for (const p of products) {
    const facts = [p.name, p.category, p.price, p.keyBenefits].filter(Boolean).join(" · ");
    content.push({ type: "text", text: `• ${facts}` });
    if (p.imageUrl) content.push(await imageBlock(p.imageUrl));
  }

  const resp = await callClaude({
    system:
      "You are a product analyst. For each product, produce ONE precise, dense paragraph describing its physical form, materials, colours (hex where visible), label/logo placement, finish (matte/gloss/frosted), and distinctive features — used VERBATIM by an image model. Never use bracketed placeholders; never transcribe real third-party handles, names, or copyright years.",
    messages: [{ role: "user", content }],
    maxTokens: 2500,
    timeoutMs: 120_000,
    tools: [CATALOG_TOOL],
    toolChoice: { type: "tool", name: "emit_catalog" },
    systemKey: SYSTEM_KEY,
    brandId: brand.id,
  });

  const out = toolResult<{ items: { name: string; paragraph: string }[] }>(resp, "emit_catalog");
  return (out?.items ?? []).filter((i) => i.paragraph?.trim()).map((i) => ({ name: i.name, paragraph: sanitize(i.paragraph) }));
}

export function inferBrandType(brand: Brand): "products" | "services" {
  if (brand.products.length > 0) return "products";
  const hay = `${brand.category ?? ""} ${brand.vibe ?? ""}`.toLowerCase();
  return /saas|software|\bapp\b|platform|agency|service|subscription|\btool\b|consult/.test(hay) ? "services" : "products";
}
