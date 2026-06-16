// Pure prompt-construction for the Static Ad setup builder — no server-only deps,
// so it's unit-testable and importable from scripts. The callClaude wiring lives
// in setup.ts (server-only).

import type Anthropic from "@anthropic-ai/sdk";
import type { Brand } from "@/lib/types";

const PLACEHOLDER_RE = /synthesi[sz]ed|\*\(|\(draft|\(edit|\(populate|\(confirm|\(tune|\(adjust|\(list|\(add\b/i;

/** A section that's empty or still carries mock-onboarding boilerplate is fair to
 *  fill; real user-written content (length ≥ 30 and no placeholder markers) is not. */
export function needsFill(content?: string | null): boolean {
  const c = (content ?? "").trim();
  return c.length < 30 || PLACEHOLDER_RE.test(c);
}

/** Compact, factual brand-DNA context shared by both Claude passes. */
export function brandDna(brand: Brand, siteText: string | null): string {
  const palette = brand.palette.map((p) => `${p.hex} (${p.role})`).join(", ");
  const products = brand.products
    .map((p) => `- ${p.name}${p.isHero ? " [HERO]" : ""}${p.category ? ` · ${p.category}` : ""}${p.price ? ` · ${p.price}` : ""}${p.keyBenefits ? ` — ${p.keyBenefits}` : ""}`)
    .join("\n");
  const usps = brand.usps.map((u) => `- ${u.text}${u.isPrimary ? " (primary)" : ""}`).join("\n");
  const sections = brand.sections
    .filter((s) => (s.content ?? "").trim().length > 0)
    .map((s) => `### ${s.title}\n${(s.content ?? "").trim().slice(0, 600)}`)
    .join("\n\n");

  return [
    `BRAND: ${brand.name}${brand.category ? ` (${brand.category})` : ""}`,
    brand.website ? `WEBSITE: ${brand.website}` : "",
    brand.tagline ? `TAGLINE: ${brand.tagline}` : "",
    brand.vibe ? `VIBE: ${brand.vibe}` : "",
    palette ? `PALETTE: ${palette}` : "",
    products ? `PRODUCTS:\n${products}` : "",
    usps ? `USPS:\n${usps}` : "",
    sections ? `EXISTING BRAND INTELLIGENCE:\n${sections}` : "",
    siteText ? `WEBSITE RESEARCH (excerpt):\n${siteText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const INTEL_TOOL: Anthropic.Tool = {
  name: "emit_brand_intel",
  description: "Return concise, factual brand-intelligence content for the requested section types.",
  input_schema: {
    type: "object",
    properties: {
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sectionType: { type: "string", description: "one of the requested section types" },
            content: { type: "string", description: "60–140 words of factual markdown prose; no placeholders or parentheticals" },
          },
          required: ["sectionType", "content"],
        },
      },
    },
    required: ["sections"],
  },
};

export const INTEL_SYSTEM =
  "You are a brand strategist. Using the brand data and website research provided, write concise, factual brand-intelligence content for ONLY the requested section types. Each section: 60–140 words of clean markdown prose, specific to this brand, with no placeholders, parentheticals, or hedging. If the website research is thin, reason from the brand name, category, products and palette.";

export const PROMPTS_TOOL: Anthropic.Tool = {
  name: "emit_static_prompts",
  description: "Return the four brand-specific system prompts for the Static Ad agents.",
  input_schema: {
    type: "object",
    properties: {
      agent1Prompt: { type: "string", description: "Vision analyzer. MUST instruct: output ONLY a single JSON object (first char {, last char })." },
      agent2Prompt: { type: "string", description: "Composer. MUST instruct: output ONLY the image-generation prompt, ending with the exact line `Aspect ratio: <ratio>`." },
      briefAgent1Prompt: { type: "string", description: "Brief-mode analyzer (reads a written brief + optional logo). Same JSON-only contract as agent1Prompt." },
      briefAgent2Prompt: { type: "string", description: "Brief-mode composer. Same output contract as agent2Prompt." },
    },
    required: ["agent1Prompt", "agent2Prompt", "briefAgent1Prompt", "briefAgent2Prompt"],
  },
};

export function authorSystemPrompt(template: { agent1Prompt: string; agent2Prompt: string }): string {
  return `You author the system prompts for a two-agent static-ad pipeline, tailored to ONE brand.

The pipeline:
- AGENT 1 (vision) analyses a reference ad image and outputs a structured JSON "format brief".
- AGENT 2 (composer) reads that JSON + the selected product image + optional copy + a required aspect ratio, and outputs ONE richly detailed image-generation prompt.
- Brief mode swaps Agent 1 for one that reads a written brief (+ optional logo) instead of a reference image.

NON-NEGOTIABLE OUTPUT CONTRACTS (every authored prompt MUST preserve these, or the pipeline breaks):
- agent1Prompt / briefAgent1Prompt: instruct the model to output ONLY a single valid JSON object — first character "{", last character "}", no prose, no code fences.
- agent2Prompt / briefAgent2Prompt: instruct the model to output ONLY the image-generation prompt text, and to END with the exact line: Aspect ratio: <the required ratio>.

Your job: rewrite the TEMPLATE prompts below into brand-specific versions that bake in this brand's voice, palette, visual direction, product world and guardrails — concrete and opinionated, not generic. Keep them comprehensive (Agent 2 should be the longest, with explicit brand-voice + layout + typography guidance). Preserve the structure and the contracts; change the substance to fit the brand.

TEMPLATE agent1Prompt:
"""${template.agent1Prompt}"""

TEMPLATE agent2Prompt:
"""${template.agent2Prompt}"""`;
}
