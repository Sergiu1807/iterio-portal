// Pure brief-shape types — shared by server (generate) + client (brief-view). No deps.

export type VideoScriptBeat = { beat?: string; vo?: string; on_screen_text?: string };
export type VideoScene = { visual?: string; vo?: string; on_screen_text?: string; duration_s?: number; shot_type?: string };
export type VideoBriefJson = {
  hook_frame?: string;
  script?: VideoScriptBeat[];
  scene_list?: VideoScene[];
  cta_frame?: string;
  pacing_notes?: string;
};

export type StaticFrame = { layout?: string; headline?: string; subhead?: string; product_placement?: string; proof_element?: string; cta?: string };
export type StaticBriefJson = {
  frames?: StaticFrame[];
  format_intent?: string[]; // e.g. ["1:1","4:5","9:16"]
};

export type BriefJson = VideoBriefJson | StaticBriefJson; // discriminated by the brief row's `format`
export type ComplianceNotes = { flag: "safe" | "risky" | "banned"; ruleRef?: string | null; notes: string[] };
