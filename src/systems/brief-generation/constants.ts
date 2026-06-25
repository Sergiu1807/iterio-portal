export const SYSTEM_KEY = "brief-generation";

export const BRIEF_FORMATS = ["static", "carousel", "video"] as const;
export type BriefFormat = (typeof BRIEF_FORMATS)[number];

export const DEPTHS = ["concise", "standard", "detailed"] as const;
export type BriefDepth = (typeof DEPTHS)[number];

export const BRIEF_STATUSES = ["pending", "running", "complete", "failed", "approved"] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

export const GEN_MODEL = "claude-sonnet-4-6";
export const GEN_TEMPERATURE = 0.7; // precise, not divergent
export const GEN_TIMEOUT_MS = 120_000;
