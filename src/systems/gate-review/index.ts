import { lazy } from "react";
import { ShieldCheck } from "lucide-react";
import type { SystemDefinition } from "../types";

export const gateReview: SystemDefinition = {
  key: "gate-review",
  name: "Compliance & QA Gate",
  icon: ShieldCheck,
  tagline: "Every asset graded on-brand, claim-safe & launch-ready before it ships.",
  description:
    "The moat. AI grades every produced creative on a 6-point scorecard — on-brand · doesn't-look-AI · compliant · hook-in-1-2s · clarity · angle integrity — against this brand's B3 compliance ruleset + creative DNA, with a human override. Nothing ships that fails.",
  capabilities: [
    "Gemini Vision: on-brand / not-AI / hook / clarity",
    "Claude: claim-safety vs the B3 per-ingredient ruleset",
    "Per-criterion pass/fail + overall gate",
    "Human override · re-grade · audit trail",
  ],
  status: "live",
  nav: { group: "ops", order: 10 },
  infra: [
    { kind: "apiKey", keyName: "ANTHROPIC_API_KEY", label: "Anthropic Claude" },
    { kind: "apiKey", keyName: "GEMINI_API_KEY", label: "Google Gemini (vision)" },
  ],
  perBrand: true,
  enabledByDefault: false,
  accent: "#3F7D6E",
  Component: lazy(() => import("./component")),
};
