export const SYSTEM_KEY = "ad-copy";

export const PLACEMENTS = ["feed", "reels", "story"] as const;
export type Placement = (typeof PLACEMENTS)[number];

export const COPY_STATUSES = ["draft", "approved"] as const;
export const COMPLIANCE_FLAGS = ["safe", "risky", "banned"] as const;

export const DEFAULT_VARIANTS = 3;
export const MAX_VARIANTS = 6;
export const GEN_MODEL = "claude-sonnet-4-6";
export const GEN_TEMPERATURE = 0.9; // variant variety
export const GEN_TIMEOUT_MS = 90_000;
