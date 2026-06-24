import type { BadgeProps } from "@/components/ui/badge";

/** Confidence band → badge variant + label (0..1). */
export function confidenceMeta(score: number | undefined): { label: string; variant: NonNullable<BadgeProps["variant"]> } | null {
  if (score == null) return null;
  if (score >= 0.8) return { label: "High", variant: "success" };
  if (score >= 0.5) return { label: "Medium", variant: "warning" };
  return { label: "Low — verify", variant: "outline" };
}

export const ASSET_SLOTS: { type: string; label: string; accept: string; multi: boolean }[] = [
  { type: "logo", label: "Logo", accept: "image/*", multi: false },
  { type: "brand_book", label: "Brand book (PDF)", accept: "application/pdf,image/*", multi: false },
  { type: "font", label: "Fonts", accept: ".ttf,.otf,.woff,.woff2", multi: true },
  { type: "product_photo", label: "Product photos", accept: "image/*", multi: true },
  { type: "winning_creative", label: "Past winning creatives", accept: "image/*", multi: true },
];

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  website: "Website",
  meta_ads: "Meta Ad Library",
  competitor: "Competitor",
  amazon: "Amazon reviews",
  trustpilot: "Trustpilot",
  google_reviews: "Google reviews",
  reddit: "Reddit community",
  social: "Instagram",
  email: "Marketing emails",
  compliance: "Compliance (FTC/FDA + EU)",
};

/** Source types deferred to a later build (no live module yet). */
export const DEFERRED_SOURCE_TYPES = ["upload"];
