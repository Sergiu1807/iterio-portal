export const SYSTEM_KEY = "gate-review";

// The scorecard — ship only if ALL pass.
export const CRITERIA = [
  { key: "on_brand", label: "On-brand", by: "vision" },
  { key: "not_ai", label: "Doesn't look AI", by: "vision" },
  { key: "compliant", label: "Compliant", by: "claim" },
  { key: "hook", label: "Hook lands in 1-2s", by: "vision" },
  { key: "clarity", label: "Clarity / single CTA", by: "vision" },
  { key: "angle_integrity", label: "Angle integrity", by: "claim" },
] as const;
export type CriterionKey = (typeof CRITERIA)[number]["key"];

export const PASS_THRESHOLD = 70; // 0..100 per criterion
export const CLAUDE_MODEL = "claude-sonnet-4-6";
export const GATE_STATUSES = ["pending", "running", "complete", "failed"] as const;
export const GEN_TIMEOUT_MS = 90_000;
