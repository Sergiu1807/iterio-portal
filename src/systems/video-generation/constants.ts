// Shared constants for the Video Generation system (client + server safe).

export const SYSTEM_KEY = "video-generation";

export const VIDEO_TYPES = [
  { value: "ugc", label: "UGC" },
  { value: "broll", label: "B-Roll" },
  { value: "aroll", label: "A-Roll" },
] as const;

export const AROLL_STYLES = [
  { value: "street-interview", label: "Street interview" },
  { value: "talking-head", label: "Talking head" },
  { value: "podcast", label: "Podcast" },
  { value: "green-screen", label: "Green screen" },
] as const;

export const DURATIONS = [5, 10, 15] as const;
export const DEFAULT_DURATION = 10;

// Kie Seedance 2 supported aspect ratios (4:5 is NOT supported — use 3:4).
export const VIDEO_ASPECT_RATIOS = ["9:16", "3:4", "1:1", "4:3", "16:9"] as const;
export const DEFAULT_ASPECT = "9:16";

export const RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export const DEFAULT_RESOLUTION = "720p";

export const MAX_VARIATIONS = 3; // video is expensive

// Supabase storage "kind" segments → brands/<slug>/<kind>/<file>
export const KIND_VIDEOS = "videos";
export const KIND_CHARACTERS = "video-characters";
export const KIND_SCENES = "video-scenes";

// Signed-URL expiry for the reference images handed to Kie (queue outlasts 1h).
export const KIE_INPUT_EXPIRY = 6 * 60 * 60; // 6h
