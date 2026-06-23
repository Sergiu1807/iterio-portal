import type { BadgeProps } from "@/components/ui/badge";

export type Longevity = { label: string; days: number; variant: NonNullable<BadgeProps["variant"]> };

/** Days-running longevity badge (New / Running / Long Run / Evergreen). */
export function longevityBadge(snapshotDate: string | null, adStartDate: string | null): Longevity | null {
  if (!adStartDate) return null;
  const start = new Date(adStartDate).getTime();
  if (Number.isNaN(start)) return null;
  const snap = snapshotDate ? new Date(snapshotDate).getTime() : Date.now();
  const days = Math.max(0, Math.floor((snap - start) / 86_400_000));
  if (days <= 7) return { label: "New", days, variant: "default" };
  if (days <= 21) return { label: "Running", days, variant: "warning" };
  if (days <= 60) return { label: "Long Run", days, variant: "accent" };
  return { label: "Evergreen", days, variant: "success" };
}

export function timeAgo(date: string | null): string {
  if (!date) return "Never";
  const d = new Date(date).getTime();
  if (Number.isNaN(d)) return "Never";
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Ads-per-scrape presets (the actor's `count`). Route caps at 100. */
export const AD_COUNTS = [10, 20, 30, 50, 100];

export const MEDIA_TYPES = ["video", "image", "carousel", "text"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export function mediaLabel(t: string | null): string {
  if (!t) return "—";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ── Winner Board ──────────────────────────────────────────────────────────
export const TIER_META: Record<string, { label: string; emoji: string; variant: NonNullable<BadgeProps["variant"]> }> = {
  proven_control: { label: "Proven control", emoji: "🏆", variant: "success" },
  scaling_now: { label: "Scaling now", emoji: "🔥", variant: "warning" },
  in_testing: { label: "In testing", emoji: "🧪", variant: "accent" },
  historical_swipe: { label: "Historical", emoji: "📚", variant: "muted" },
};

export function tierMeta(tier: string | null) {
  return tier ? TIER_META[tier] ?? null : null;
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Confidence → a dot colour class. */
export const CONFIDENCE_DOT: Record<string, string> = {
  high: "bg-success",
  medium: "bg-warning",
  low: "bg-muted-foreground/40",
};

export const COUNTRIES = [
  "ALL", "US", "GB", "CA", "AU", "NZ", "IE", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "DK", "FI", "PT", "BE", "AT", "CH", "PL", "BR", "MX", "JP", "SG", "AE",
];
