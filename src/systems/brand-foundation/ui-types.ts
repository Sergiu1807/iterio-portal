import type { B3 } from "./b3-schema";

export type IntelRow = {
  id: string;
  brandId: string;
  version: number;
  status: "draft" | "approved";
  json: B3;
  confidenceJson: Record<string, number>;
  gapsJson: { field: string; severity: string; reason: string }[];
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BrandSource = {
  id: string;
  brandId: string;
  type: string;
  url: string | null;
  handle: string | null;
  config: Record<string, unknown>;
  status: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastError: string | null;
};

export type BrandAsset = {
  id: string;
  type: string;
  storageKey: string;
  url: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
};

export type OnboardStep = "inputs" | "review" | "approve";
