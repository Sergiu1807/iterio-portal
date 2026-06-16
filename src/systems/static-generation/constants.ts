// Shared constants for the Static Ad system (safe for client + server import).

export const SYSTEM_KEY = "static-generation";

export const ASPECT_RATIOS = ["1:1", "4:5", "9:16", "16:9"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const RESOLUTIONS = ["1K", "2K", "4K"] as const;
export const DEFAULT_RESOLUTION = "2K";

export const MAX_VARIATIONS = 4;

// Supabase storage "kind" segments → brands/<slug>/<kind>/<file>
export const KIND_ADS = "static-ads";
export const KIND_REFERENCES = "static-references";
export const KIND_BRAND = "brand";

// Signed-URL expiry for inputs handed to Kie (its queue can outlast a 1h URL).
export const KIE_INPUT_EXPIRY = 6 * 60 * 60; // 6h
