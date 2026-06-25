// Pure prompt-construction + parsing + the deterministic compliance scan — no
// server-only deps, so it's unit-testable and importable from scripts.
import type Anthropic from "@anthropic-ai/sdk";
import type { BrandGrounding } from "@/lib/brand-grounding";
import type { ComplianceFlag } from "./constants";

export type GenParams = {
  objective?: string;
  funnelStage: string; // TOF | MOF | BOF | any
  formats: string[]; // static | carousel | video | any
  count: number;
  theme?: string;
  productName?: string;
  seedAngle?: { title?: string; bigIdea?: string; emotionalDriver?: string }; // regenerate-similar
};

export type RawAngle = {
  title?: string;
  format?: string;
  funnel_stage?: string;
  big_idea?: string;
  hook?: string;
  emotional_driver?: string;
  target_persona?: string;
  proof_mechanism?: string;
  compliance_flag?: string;
  rule_ref?: string;
  source_inspiration?: string;
  differentiation_note?: string;
  score?: number;
};

export const EMIT_ANGLES_TOOL: Anthropic.Tool = {
  name: "emit_angles",
  description: "Return a bank of distinct, on-brand creative angles/concepts.",
  input_schema: {
    type: "object",
    properties: {
      angles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short name for the angle." },
            format: { type: "string", description: "static | carousel | video — the format this angle is strongest in." },
            funnel_stage: { type: "string", description: "TOF | MOF | BOF" },
            big_idea: { type: "string", description: "The concept — what makes this angle distinct, in 1-2 sentences." },
            hook: { type: "string", description: "The opening line or visual that grabs attention." },
            emotional_driver: { type: "string", description: "The core emotional driver (e.g. fear-of-missing-relief, aspiration, belonging, frustration)." },
            target_persona: { type: "string", description: "Which persona this speaks to (use the brand's real personas)." },
            proof_mechanism: { type: "string", description: "The proof/credibility lever it leans on (clinical, ingredient, social, founder, transformation)." },
            compliance_flag: { type: "string", enum: ["safe", "risky", "banned"], description: "safe = no risky claims; risky = touches a regulated claim; banned = requires a banned claim (avoid)." },
            rule_ref: { type: "string", description: "If risky/banned, which compliance rule or banned phrasing it touches." },
            source_inspiration: { type: "string", description: "Which winner pattern, VOC phrase, or gap-analysis insight it draws on." },
            differentiation_note: { type: "string", description: "Why this angle is distinct from the others in the set." },
            score: { type: "number", description: "0..10 = relevance × novelty × brand-fit." },
          },
          required: ["title", "big_idea", "hook", "emotional_driver", "compliance_flag"],
        },
      },
    },
    required: ["angles"],
  },
};

export const IDEATION_SYSTEM =
  "You are an elite direct-response creative strategist. From the brand intelligence provided, generate a bank of distinct, on-brand creative ANGLES (strategic concepts), each ready to become a brief. Rules:\n" +
  "1. GROUND every angle in the real brand: use its positioning, personas (quote their_words verbatim where it sharpens a hook), emotional triggers, proof mechanisms, voice, products, and especially the WINNING PATTERNS and GAP ANALYSIS. Never invent facts or claims the brand can't support.\n" +
  "2. DIFFERENTIATION GRID (hard rule): no two angles may overlap on more than ONE of {emotional_driver, format, target_persona, proof_mechanism}. Every angle must be a genuinely different bet. State the distinction in differentiation_note.\n" +
  "3. COMPLIANCE (hard rule): NEVER generate an angle whose hook/idea REQUIRES a banned phrasing or a disallowed claim. If an angle merely touches a regulated area, set compliance_flag='risky' and name the rule in rule_ref. Reserve 'banned' for angles that cannot work without a banned claim — prefer to not generate those at all.\n" +
  "4. Tag each angle with format (pick the format it's strongest in, honoring the requested formats), funnel_stage, emotional_driver, target_persona, proof_mechanism, and a 0..10 score (relevance × novelty × brand-fit).\n" +
  "5. Make hooks specific and scroll-stopping — not generic. Lead with the customer's world, not the product.";

export function buildIdeationUserMessage(grounding: BrandGrounding, params: GenParams): string {
  const formats = params.formats.length ? params.formats.join(", ") : "any";
  const banned = grounding.compliance.banned_phrasings;
  const bannedBlock = banned.length ? `\n\nHARD COMPLIANCE DENYLIST (never require any of these phrasings):\n${banned.map((b) => `- ${b}`).join("\n")}` : "";
  const rulesBlock = grounding.compliance.rules.length
    ? `\n\nCOMPLIANCE RULES:\n${grounding.compliance.rules.slice(0, 30).map((r) => `- ${r.subject ?? ""}${r.verdict ? ` → ${r.verdict}` : ""}${r.rationale ? ` (${r.rationale})` : ""}`).join("\n")}`
    : "";
  const seedBlock = params.seedAngle
    ? `\n\nREGENERATE-SIMILAR SEED — produce fresh angles in the SPIRIT of this one but NOT duplicates (vary driver/persona/mechanism):\n- ${params.seedAngle.title ?? ""}: ${params.seedAngle.bigIdea ?? ""}${params.seedAngle.emotionalDriver ? ` [driver: ${params.seedAngle.emotionalDriver}]` : ""}`
    : "";

  return [
    `=== BRAND INTELLIGENCE (grounding source: ${grounding.source}${grounding.version ? ` v${grounding.version}` : ""}) ===`,
    grounding.text || "(no brand intelligence available — generate cautiously and flag low confidence)",
    bannedBlock,
    rulesBlock,
    seedBlock,
    `\n=== REQUEST ===`,
    `Objective: ${params.objective || "(none specified — infer from the brand)"}`,
    `Funnel stage: ${params.funnelStage}`,
    `Target format(s): ${formats}`,
    params.productName ? `Focus product: ${params.productName}` : "",
    params.theme ? `Theme / seed: ${params.theme}` : "",
    `\nGenerate exactly ${params.count} distinct angles via the emit_angles tool. Enforce the differentiation grid and compliance rules above.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const CUSTOMER_FIELDS: (keyof RawAngle)[] = ["title", "big_idea", "hook", "differentiation_note"];

/**
 * Deterministic compliance backstop — the model can miss. Scan the customer-facing
 * fields against the brand's banned phrasings (+ rule subjects marked banned); any
 * hit downgrades the angle to 'banned' and records the matched phrase.
 */
export function complianceScan(
  angle: RawAngle,
  bannedPhrasings: string[],
  bannedSubjects: string[] = []
): { flag: ComplianceFlag; ruleRef: string | null } {
  const modelFlag = (["safe", "risky", "banned"].includes(String(angle.compliance_flag)) ? angle.compliance_flag : "safe") as ComplianceFlag;
  const haystack = CUSTOMER_FIELDS.map((f) => String(angle[f] ?? "")).join(" \n ").toLowerCase();
  const denylist = [...bannedPhrasings, ...bannedSubjects].map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 3);
  for (const phrase of denylist) {
    if (haystack.includes(phrase)) {
      return { flag: "banned", ruleRef: `matched banned phrasing: "${phrase}"` };
    }
  }
  return { flag: modelFlag, ruleRef: angle.rule_ref?.trim() || null };
}
