export type AdCopy = {
  id: string;
  batchId: string;
  brandId: string;
  angleId: string | null;
  briefId: string | null;
  placement: string | null;
  primaryText: string | null;
  headline: string | null;
  cta: string | null;
  variantIndex: number;
  complianceFlag: "safe" | "risky" | "banned";
  ruleRef: string | null;
  status: "draft" | "approved";
  createdAt: string;
};

export type AdCopyBatch = {
  id: string;
  status: "pending" | "running" | "complete" | "failed";
  placement: string;
  variantCount: number;
  groundingSource: string | null;
  b3Version: number | null;
  errorMessage: string | null;
  costCents: number;
  createdAt: string;
};
