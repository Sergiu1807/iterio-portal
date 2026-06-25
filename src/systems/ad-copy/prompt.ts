import type Anthropic from "@anthropic-ai/sdk";
import type { BrandGrounding } from "@/lib/brand-grounding";

export type CopyGenParams = { placement: string; variantCount: number; funnelStage: string; sourceContext: string };
export type RawCopy = { placement?: string; primary_text?: string; headline?: string; cta?: string; variant_index?: number; compliance_flag?: string; rule_ref?: string };

export const EMIT_COPY: Anthropic.Tool = {
  name: "emit_copy",
  description: "Return N distinct ad-copy variants (the in-feed text that ships with the creative).",
  input_schema: {
    type: "object",
    properties: {
      variants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            primary_text: { type: "string", description: "The main in-feed body copy." },
            headline: { type: "string", description: "Short headline (under the creative)." },
            cta: { type: "string", description: "Call-to-action button text or closing line." },
            compliance_flag: { type: "string", enum: ["safe", "risky", "banned"] },
            rule_ref: { type: "string", description: "If risky/banned, the rule/phrasing it touches." },
          },
          required: ["primary_text", "headline", "cta", "compliance_flag"],
        },
      },
    },
    required: ["variants"],
  },
};

export const COPY_SYSTEM =
  "You are a direct-response copywriter. Write the in-feed ad copy (primary text · headline · CTA) that ships WITH a creative. Rules:\n" +
  "1. Write in THIS brand's voice (voice_profile) for the target persona; use customers' own words (their_words) where it sharpens a line.\n" +
  "2. Each variant must take a genuinely DIFFERENT lead / angle of attack (e.g. problem-first, social-proof-first, mechanism-first, founder-first) — not synonym swaps.\n" +
  "3. COMPLIANCE (hard): never write a line that REQUIRES a banned phrasing or an unsupported claim. Flag risky lines with the rule. Keep claims honest.\n" +
  "4. Match the placement (feed = scannable; reels/story = punchy, short).";

export function buildCopyUserMessage(grounding: BrandGrounding, params: CopyGenParams): string {
  const banned = grounding.compliance.banned_phrasings;
  return [
    `=== BRAND (grounding: ${grounding.source}${grounding.version ? ` v${grounding.version}` : ""}) ===`,
    grounding.text || "(no brand intelligence available — be conservative)",
    banned.length ? `\nNEVER use these phrasings (compliance denylist): ${banned.join("; ")}` : "",
    grounding.compliance.required_disclaimers.length ? `Required disclaimers: ${grounding.compliance.required_disclaimers.join("; ")}` : "",
    `\n=== WHAT THIS COPY IS FOR ===`,
    params.sourceContext,
    `\n=== REQUEST ===`,
    `Placement: ${params.placement}  ·  Funnel: ${params.funnelStage}`,
    `Write exactly ${params.variantCount} DISTINCT copy variants via emit_copy — each a different lead/angle of attack.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const CUSTOMER_FIELDS: (keyof RawCopy)[] = ["primary_text", "headline", "cta"];

/** Deterministic compliance backstop on the customer-facing copy fields. */
export function scanCopyCompliance(c: RawCopy, bannedPhrasings: string[], bannedSubjects: string[] = []): { flag: "safe" | "risky" | "banned"; ruleRef: string | null } {
  const modelFlag = (["safe", "risky", "banned"].includes(String(c.compliance_flag)) ? c.compliance_flag : "safe") as "safe" | "risky" | "banned";
  const hay = CUSTOMER_FIELDS.map((f) => String(c[f] ?? "")).join(" \n ").toLowerCase();
  const denylist = [...bannedPhrasings, ...bannedSubjects].map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 3);
  for (const phrase of denylist) if (hay.includes(phrase)) return { flag: "banned", ruleRef: `matched banned phrasing: "${phrase}"` };
  return { flag: modelFlag, ruleRef: c.rule_ref?.trim() || null };
}
