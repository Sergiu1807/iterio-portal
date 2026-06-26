// Composite Winner Score — pure functions, no DB.
// Implements the spec's reference model. EU reach is null in v1 (no official Meta
// API yet): the reach term is DROPPED and the remaining weights are RENORMALIZED,
// and confidence is capped at "medium". When reach lands (v2) the same code lights up.

export type Weights = { longevity: number; scaling: number; reachVel: number; spread: number };

export const WEIGHTS: Weights = { longevity: 0.3, scaling: 0.35, reachVel: 0.2, spread: 0.1 };
export const RELAUNCH_BONUS = 0.05; // spec: resurrection bonus = +0.05
export const NICHE_BENCHMARK = 50_000; // EU reach/day baseline; unused in v1 (reach null)

// Tunable tier thresholds. Highest-priority match wins (see assignTier).
export const TIER = {
  proven: { minActiveDays: 45, minVariants: 4, minScore: 72 },
  scaling: { minActiveDays: 7, maxActiveDays: 60, minVariants: 3, minScore: 58 },
  testing: { maxActiveDays: 14, maxVariants: 2 },
  historical: { minPeakDays: 30 },
} as const;

export type WinnerTier = "proven_control" | "scaling_now" | "in_testing" | "historical_swipe" | null;

export type Signals = {
  activeDays: number;
  activeVariantCount: number;
  variantDeltaWoW: number; // active variants now − previous run
  distinctFormats: number;
  euReachPerDay: number | null; // v1: null
  resurrected: boolean;
  daysSinceLastActive: number; // 0 when still active
  stillActive: boolean;
  peakActiveDays: number;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export type ScoreResult = {
  score: number; // 0..100
  base: number;
  recency: number;
  components: { longevity: number; scaling: number; spread: number; reachVel: number | null };
};

export function computeConceptScore(s: Signals, w: Weights = WEIGHTS): ScoreResult {
  const longevity = clamp01(s.activeDays / 90); // saturates ~90d
  const scaling = clamp01(s.activeVariantCount / 12); // 12+ near-dup actives = maxed
  const spread = clamp01(s.distinctFormats / 4);
  const reachVel = s.euReachPerDay == null ? null : clamp01(s.euReachPerDay / NICHE_BENCHMARK);

  // Active weight set — drop reachVel when null, then renormalize the rest to sum 1.
  const parts: { v: number; w: number }[] = [
    { v: longevity, w: w.longevity },
    { v: scaling, w: w.scaling },
    { v: spread, w: w.spread },
  ];
  if (reachVel != null) parts.push({ v: reachVel, w: w.reachVel });

  const wSum = parts.reduce((a, p) => a + p.w, 0); // null-reach path → 0.30+0.35+0.10 = 0.75
  const weighted = wSum > 0 ? parts.reduce((a, p) => a + (p.w / wSum) * p.v, 0) : 0;

  const relaunch = s.resurrected ? RELAUNCH_BONUS : 0;
  const base = clamp01(weighted + relaunch); // bonus added AFTER the weighted sum
  const recency = Math.exp(-Math.max(0, s.daysSinceLastActive) / 30); // 1.0 if active today
  const score = Math.round(100 * base * recency);

  return { score, base, recency, components: { longevity, scaling, spread, reachVel } };
}

export function confidence(s: Signals): "high" | "medium" | "low" {
  const strong = [s.activeDays >= 30, s.activeVariantCount >= 3, s.distinctFormats >= 2].filter(Boolean).length;
  if (s.euReachPerDay != null && strong >= 2) return "high";
  if (strong >= 2) return "medium";
  return "low";
}

// Assign the highest-priority tier that matches, in order.
export function assignTier(s: Signals, score: number): WinnerTier {
  if (
    s.stillActive &&
    s.activeDays >= TIER.proven.minActiveDays &&
    s.activeVariantCount >= TIER.proven.minVariants &&
    score >= TIER.proven.minScore
  )
    return "proven_control";
  if (
    s.stillActive &&
    (s.variantDeltaWoW > 0 || s.activeVariantCount >= TIER.scaling.minVariants) &&
    s.activeDays >= TIER.scaling.minActiveDays &&
    s.activeDays <= TIER.scaling.maxActiveDays &&
    score >= TIER.scaling.minScore
  )
    return "scaling_now";
  if (s.stillActive && s.activeDays < TIER.testing.maxActiveDays && s.activeVariantCount <= TIER.testing.maxVariants)
    return "in_testing";
  if (!s.stillActive && s.peakActiveDays >= TIER.historical.minPeakDays) return "historical_swipe";
  return null;
}

export const TIER_LABEL: Record<NonNullable<WinnerTier>, string> = {
  proven_control: "Proven control",
  scaling_now: "Scaling now",
  in_testing: "In testing",
  historical_swipe: "Historical swipe",
};
