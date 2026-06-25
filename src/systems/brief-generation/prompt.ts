// Pure prompt-construction + tool schemas + the deterministic compliance carry-through.
import type Anthropic from "@anthropic-ai/sdk";
import type { BrandGrounding } from "@/lib/brand-grounding";
import type { ComplianceNotes } from "./types";

export type AngleContext = {
  title: string;
  format: string | null;
  funnelStage: string | null;
  bigIdea: string | null;
  hook: string | null;
  emotionalDriver: string | null;
  targetPersona: string | null;
  proofMechanism: string | null;
  complianceFlag: string;
  ruleRef: string | null;
  sourceInspiration: string | null;
};

export type ReferenceTeardown = { label: string; facts: string } | null;

export const EMIT_VIDEO_BRIEF: Anthropic.Tool = {
  name: "emit_video_brief",
  description: "Return a complete, production-ready VIDEO brief: hook frame, script, scene-by-scene shot list, CTA frame.",
  input_schema: {
    type: "object",
    properties: {
      hook_frame: { type: "string", description: "The opening 0-3s: exactly what's on screen + said to stop the scroll." },
      script: { type: "array", description: "The spoken/on-screen script, beat by beat.", items: { type: "object", properties: { beat: { type: "string" }, vo: { type: "string", description: "voiceover / spoken line" }, on_screen_text: { type: "string" } } } },
      scene_list: { type: "array", description: "Scene-by-scene shot list.", items: { type: "object", properties: { visual: { type: "string" }, vo: { type: "string" }, on_screen_text: { type: "string" }, duration_s: { type: "number" }, shot_type: { type: "string", description: "talking-head | b-roll | product | text-card | etc." } } } },
      cta_frame: { type: "string", description: "Closing CTA frame: visual + words." },
      pacing_notes: { type: "string", description: "Music/energy/pacing direction." },
      compliance_notes: { type: "array", items: { type: "string" }, description: "Per-claim compliance notes Production must honor." },
    },
    required: ["hook_frame", "scene_list", "cta_frame"],
  },
};

export const EMIT_STATIC_BRIEF: Anthropic.Tool = {
  name: "emit_static_brief",
  description: "Return a complete static/carousel brief: every visual element per frame, plus multi-format intent.",
  input_schema: {
    type: "object",
    properties: {
      frames: { type: "array", description: "One entry per static / carousel slide.", items: { type: "object", properties: { layout: { type: "string", description: "composition / where things sit" }, headline: { type: "string", description: "on-image headline" }, subhead: { type: "string" }, product_placement: { type: "string" }, proof_element: { type: "string", description: "the proof/credibility element shown" }, cta: { type: "string" } } } },
      format_intent: { type: "array", items: { type: "string" }, description: "Which crops this is built for, e.g. 1:1, 4:5, 9:16." },
      compliance_notes: { type: "array", items: { type: "string" }, description: "Per-claim compliance notes Production must honor." },
    },
    required: ["frames"],
  },
};

export const BRIEF_SYSTEM =
  "You are a senior creative director + producer. Turn an APPROVED angle into a complete, production-ready brief, fully grounded in the brand. Rules:\n" +
  "1. GROUND in the brand: honor its positioning, voice_profile (write any spoken/on-image lines in that voice), personas (use their_words where it sharpens a line), proof_mechanisms, products and creative_dna.\n" +
  "2. EXPAND the angle — never drop or weaken its big_idea, hook, emotional_driver, target_persona or proof_mechanism. The brief is the angle made buildable.\n" +
  "3. COMPLIANCE (hard): never write a line/visual that REQUIRES a banned phrasing or an unsupported claim. Surface per-claim notes in compliance_notes so Production inherits them. If the angle came in flagged risky, keep it honest and note the rule.\n" +
  "4. If a REFERENCE creative is provided, recreate its winning STRUCTURE on-brand — never copy it verbatim.\n" +
  "5. Be specific and shootable/designable — real shots, real on-screen text, real layout — not vague direction.";

export function buildBriefUserMessage(grounding: BrandGrounding, angle: AngleContext, opts: { format: string; depth: string; notes?: string | null }, reference: ReferenceTeardown): string {
  const isVideo = opts.format === "video";
  return [
    `=== BRAND INTELLIGENCE (grounding: ${grounding.source}${grounding.version ? ` v${grounding.version}` : ""}) ===`,
    grounding.text || "(no brand intelligence available — be conservative)",
    `\n=== APPROVED ANGLE (expand this; do not drop any element) ===`,
    `Title: ${angle.title}`,
    angle.bigIdea ? `Big idea: ${angle.bigIdea}` : "",
    angle.hook ? `Hook: ${angle.hook}` : "",
    `Format: ${opts.format}  ·  Funnel: ${angle.funnelStage ?? "TOF"}`,
    angle.emotionalDriver ? `Emotional driver: ${angle.emotionalDriver}` : "",
    angle.targetPersona ? `Target persona: ${angle.targetPersona}` : "",
    angle.proofMechanism ? `Proof mechanism: ${angle.proofMechanism}` : "",
    angle.sourceInspiration ? `Drawn from: ${angle.sourceInspiration}` : "",
    angle.complianceFlag !== "safe" ? `⚠ Inherited compliance: ${angle.complianceFlag}${angle.ruleRef ? ` — ${angle.ruleRef}` : ""} (carry this through, keep claims honest)` : "",
    grounding.compliance.banned_phrasings.length ? `\nNEVER use these phrasings (compliance denylist): ${grounding.compliance.banned_phrasings.join("; ")}` : "",
    grounding.compliance.required_disclaimers.length ? `Required disclaimers: ${grounding.compliance.required_disclaimers.join("; ")}` : "",
    reference ? `\n=== REFERENCE WINNER — recreate its STRUCTURE on-brand (do NOT copy) ===\n${reference.label}\n${reference.facts}` : "",
    opts.notes ? `\nOperator notes: ${opts.notes}` : "",
    `\n=== REQUEST ===`,
    isVideo
      ? `Produce a complete VIDEO brief (${opts.depth} depth) via emit_video_brief: hook frame, full script, scene-by-scene shot list with durations + shot types, CTA frame, pacing.`
      : `Produce a complete ${opts.format.toUpperCase()} brief (${opts.depth} depth) via emit_static_brief: every visual element per frame (layout, headline, subhead, product placement, proof element, CTA) + the multi-format intent (1:1, 4:5, 9:16).`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Deterministic compliance carry-through: start from the angle's flag, then scan the
 *  generated brief text against the brand denylist. Worst-of wins; never silently drops. */
export function carryCompliance(
  briefText: string,
  inheritedFlag: string,
  inheritedRule: string | null,
  bannedPhrasings: string[],
  bannedSubjects: string[] = []
): ComplianceNotes {
  const notes: string[] = [];
  let flag: ComplianceNotes["flag"] = (["safe", "risky", "banned"].includes(inheritedFlag) ? inheritedFlag : "safe") as ComplianceNotes["flag"];
  let ruleRef: string | null = inheritedRule?.trim() || null;
  if (inheritedFlag === "risky" || inheritedFlag === "banned") notes.push(`Inherited from angle: ${inheritedFlag}${inheritedRule ? ` — ${inheritedRule}` : ""}`);

  const hay = briefText.toLowerCase();
  const denylist = [...bannedPhrasings, ...bannedSubjects].map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 3);
  for (const phrase of denylist) {
    if (hay.includes(phrase)) {
      flag = "banned";
      ruleRef = `matched banned phrasing: "${phrase}"`;
      notes.push(`Brief text contains a banned phrasing: "${phrase}" — must be removed before production.`);
    }
  }
  return { flag, ruleRef, notes };
}
