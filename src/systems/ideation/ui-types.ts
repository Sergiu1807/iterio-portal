export type IdeationAngle = {
  id: string;
  batchId: string;
  title: string;
  format: string | null;
  funnelStage: string | null;
  bigIdea: string | null;
  hook: string | null;
  emotionalDriver: string | null;
  targetPersona: string | null;
  proofMechanism: string | null;
  complianceFlag: "safe" | "risky" | "banned";
  ruleRef: string | null;
  sourceInspiration: string | null;
  differentiationNote: string | null;
  score: string | null; // numeric → string over the wire
  status: "draft" | "shortlisted" | "approved" | "sent_to_brief";
  briefId: string | null;
  createdAt: string;
};

export type IdeationBatch = {
  id: string;
  status: "pending" | "running" | "complete" | "failed";
  count: number;
  objective: string | null;
  funnelStage: string;
  formats: string[];
  theme: string | null;
  groundingSource: string | null;
  b3Version: number | null;
  errorMessage: string | null;
  costCents: number;
  createdAt: string;
  completedAt: string | null;
};
