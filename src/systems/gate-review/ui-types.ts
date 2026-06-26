export type GateCriterion = { key: string; label: string; score: number; pass: boolean; note: string };

export type GateReview = {
  id: string;
  brandId: string;
  sourceSystem: string;
  sourceId: string | null;
  assetPath: string | null;
  assetUrl: string | null;
  copyText: string | null;
  status: "pending" | "running" | "complete" | "failed";
  overallPass: boolean | null;
  criteriaJson: GateCriterion[];
  reviewer: "ai" | "human";
  overridden: boolean;
  groundingSource: string | null;
  b3Version: number | null;
  notes: string | null;
  errorMessage: string | null;
  costCents: number;
  createdAt: string;
  completedAt: string | null;
};

export type Reviewable = { sourceSystem: "static"; id: string; imagePath: string | null; thumbUrl: string | null; label: string; aspectRatio: string | null };
