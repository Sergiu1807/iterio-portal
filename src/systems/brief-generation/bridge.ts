// The Ideation → Brief handoff (mirrors the competitor-research remake-prefill bridge).
export const BRIEF_PREFILL_KEY = "iterio:brief-prefill";
export type BriefPrefill = { target: "brief"; brandId: string; angleId: string; title?: string; format?: string | null };
