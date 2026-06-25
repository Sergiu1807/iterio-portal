export const SYSTEM_KEY = "ideation";

export const FUNNEL_STAGES = ["TOF", "MOF", "BOF"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FORMATS = ["static", "carousel", "video", "any"] as const;
export type AngleFormat = (typeof FORMATS)[number];

export const COMPLIANCE_FLAGS = ["safe", "risky", "banned"] as const;
export type ComplianceFlag = (typeof COMPLIANCE_FLAGS)[number];

export const ANGLE_STATUSES = ["draft", "shortlisted", "approved", "sent_to_brief"] as const;
export type AngleStatus = (typeof ANGLE_STATUSES)[number];

export const DEFAULT_COUNT = 8;
export const MAX_COUNT = 16;
export const GEN_MODEL = "claude-sonnet-4-6";
export const GEN_TEMPERATURE = 1.0; // divergence
export const GEN_TIMEOUT_MS = 120_000;
