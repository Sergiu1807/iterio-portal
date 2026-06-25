import type { ComplianceNotes } from "./types";

export type Brief = {
  id: string;
  brandId: string;
  angleId: string | null;
  productId: string | null;
  format: string;
  funnelStage: string | null;
  status: "pending" | "running" | "complete" | "failed" | "approved";
  groundingSource: string | null;
  b3Version: number | null;
  briefJson: Record<string, unknown> | null;
  referenceRef: { kind: string; id: string; storageKey?: string | null } | null;
  complianceNotesJson: ComplianceNotes;
  depth: string;
  notes: string | null;
  errorMessage: string | null;
  costCents: number;
  sentToProduction: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type BriefReference = { kind: "competitor_ad" | "static"; id: string; storageKey: string | null; label: string; sub: string | null; thumbUrl: string | null };
