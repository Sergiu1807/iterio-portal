// Pure prompt-construction + scorecard assembly + deterministic claim scan.
import type Anthropic from "@anthropic-ai/sdk";
import type { BrandGrounding, BrandCreativeAssets } from "@/lib/brand-grounding";
import { CRITERIA, PASS_THRESHOLD } from "./constants";

export type VisionScores = {
  on_brand?: { score?: number; note?: string };
  not_ai?: { score?: number; note?: string };
  hook?: { score?: number; note?: string };
  clarity?: { score?: number; note?: string };
  on_image_text?: string;
};

export type ClaimScores = { compliant_score?: number; compliant_note?: string; angle_integrity_score?: number; angle_note?: string; claim_notes?: string[] };

/** Gemini vision prompt — scores the 4 visual criteria + extracts the on-image text. */
export function buildVisionPrompt(assets: BrandCreativeAssets, brandName: string): string {
  const palette = assets.palette.map((p) => `${p.hex}${p.role ? ` (${p.role})` : ""}`).join(", ");
  return [
    `You are a senior creative QA reviewer grading an ad creative for "${brandName}" before it ships. The FIRST image is the creative; any later image is the brand logo (for the on-brand check).`,
    `Brand visual identity:`,
    palette ? `- Palette: ${palette}` : "",
    assets.fonts?.display || assets.fonts?.body ? `- Fonts: ${[assets.fonts.display, assets.fonts.body].filter(Boolean).join(" / ")}` : "",
    assets.visualStyle ? `- Visual style: ${assets.visualStyle}` : "",
    assets.do.length ? `- Do: ${assets.do.join("; ")}` : "",
    assets.dont.length ? `- Don't: ${assets.dont.join("; ")}` : "",
    `\nScore the CREATIVE 0..100 on each (be a strict but fair reviewer):`,
    `- on_brand: matches this brand's palette / fonts / logo / visual style.`,
    `- not_ai: looks human-made & authentic, NOT obviously AI-generated/slop (warped text, melted hands, uncanny artifacts → low).`,
    `- hook: the visual + headline grab attention in the first 1-2 seconds.`,
    `- clarity: one job per element, a single clear CTA, not cluttered.`,
    `Also read ALL text visible on the creative into on_image_text.`,
    `Return ONLY JSON: {"on_brand":{"score":N,"note":"..."},"not_ai":{"score":N,"note":"..."},"hook":{"score":N,"note":"..."},"clarity":{"score":N,"note":"..."},"on_image_text":"..."}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const CLAIM_SAFETY_TOOL: Anthropic.Tool = {
  name: "emit_claim_safety",
  description: "Grade the creative's claim-safety vs the brand compliance ruleset, and its angle integrity.",
  input_schema: {
    type: "object",
    properties: {
      compliant_score: { type: "number", description: "0..100 — how claim-safe the on-creative text is vs the ruleset (100 = nothing risky)." },
      compliant_note: { type: "string", description: "Why — name any claim that's risky/banned." },
      claim_notes: { type: "array", items: { type: "string" }, description: "Per-claim notes Production must honor." },
      angle_integrity_score: { type: "number", description: "0..100 — is it built on a real angle/mechanism, not just 'pretty'?" },
      angle_note: { type: "string" },
    },
    required: ["compliant_score", "angle_integrity_score"],
  },
};

export const CLAIM_SYSTEM =
  "You are a regulatory + creative-strategy QA reviewer for a supplements/health DTC brand. Grade two things from the supplied on-creative text + copy: (1) CLAIM-SAFETY vs the brand's compliance ruleset — never allow a banned phrasing or an unsupported disease/efficacy claim; name anything risky. (2) ANGLE INTEGRITY — is the ad built on a real mechanism/insight, not just a pretty visual? Be strict; this is the final gate before a regulated brand ships.";

export function buildClaimMessage(grounding: BrandGrounding, onImageText: string, copyText: string | null, inheritedFlag: string | null): string {
  return [
    `BRAND: ${grounding.brandName}`,
    grounding.compliance.banned_phrasings.length ? `BANNED PHRASINGS (any presence = fail compliant):\n${grounding.compliance.banned_phrasings.map((b) => `- ${b}`).join("\n")}` : "(no explicit banned-phrasing list — judge against general FTC/FDA + EU/EFSA supplement rules)",
    grounding.compliance.rules.length ? `COMPLIANCE RULES:\n${grounding.compliance.rules.slice(0, 30).map((r) => `- ${r.subject ?? ""}${r.verdict ? ` → ${r.verdict}` : ""}`).join("\n")}` : "",
    grounding.compliance.required_disclaimers.length ? `REQUIRED DISCLAIMERS: ${grounding.compliance.required_disclaimers.join("; ")}` : "",
    inheritedFlag && inheritedFlag !== "safe" ? `⚠ This creative's source was flagged "${inheritedFlag}" upstream — scrutinize accordingly.` : "",
    `\n=== TEXT ON / WITH THE CREATIVE ===`,
    `On-image text: ${onImageText || "(none read)"}`,
    copyText ? `Ad copy: ${copyText}` : "",
    `\nGrade claim-safety + angle integrity via emit_claim_safety.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const clamp100 = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0; };

/** Combine the vision + claim scores into the 6-criterion scorecard. A deterministic
 *  banned-phrasing hit on the read text hard-fails `compliant`. */
export function buildScorecard(
  vision: VisionScores,
  claim: ClaimScores,
  bannedPhrasings: string[],
  visionOk: boolean
): { criteria: { key: string; label: string; score: number; pass: boolean; note: string }[]; overallPass: boolean; onImageText: string } {
  const text = (vision.on_image_text ?? "").toLowerCase();
  const hardHit = bannedPhrasings.map((b) => b.trim().toLowerCase()).filter((b) => b.length >= 3).find((b) => text.includes(b));
  const NOT_ASSESSED = "Not assessed — vision provider (Gemini) unavailable.";

  const visual = (s?: { score?: number; note?: string }) => visionOk ? { score: clamp100(s?.score), note: s?.note ?? "" } : { score: 0, note: NOT_ASSESSED };
  const raw: Record<string, { score: number; note: string }> = {
    on_brand: visual(vision.on_brand),
    not_ai: visual(vision.not_ai),
    compliant: hardHit
      ? { score: 0, note: `Contains a banned phrasing: "${hardHit}".` }
      : { score: clamp100(claim.compliant_score), note: claim.compliant_note ?? "" },
    hook: visual(vision.hook),
    clarity: visual(vision.clarity),
    angle_integrity: { score: clamp100(claim.angle_integrity_score), note: claim.angle_note ?? "" },
  };

  const criteria = CRITERIA.map((c) => ({ key: c.key, label: c.label, score: raw[c.key].score, pass: raw[c.key].score >= PASS_THRESHOLD, note: raw[c.key].note }));
  return { criteria, overallPass: criteria.every((c) => c.pass), onImageText: vision.on_image_text ?? "" };
}

export function parseVisionJson(text: string): VisionScores {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  try { return JSON.parse(t) as VisionScores; } catch { return {}; }
}
