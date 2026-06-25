import { lazy } from "react";
import { Lightbulb } from "lucide-react";
import type { SystemDefinition } from "../types";

export const ideation: SystemDefinition = {
  key: "ideation",
  name: "Ideation",
  icon: Lightbulb,
  tagline: "Turn brand intelligence into a ranked bank of on-brand, differentiated angles.",
  description:
    "The strategic layer: reads this brand's approved Brand Intelligence (B3) — positioning, personas, emotional triggers, proof, winning patterns and compliance — and generates distinct, compliance-pre-screened creative angles for static, carousel and video, ready to hand off to a brief.",
  capabilities: [
    "Grounds directly on the brand's B3 (voice, personas, winners, compliance)",
    "Differentiation grid — no two angles overlap on more than one dimension",
    "Compliance pre-screen on every angle (model tag + deterministic scan)",
    "Shortlist, approve and send-to-brief from a browsable angle library",
  ],
  status: "live",
  nav: { group: "create", order: 10 },
  infra: [{ kind: "apiKey", keyName: "ANTHROPIC_API_KEY", label: "Anthropic Claude" }],
  perBrand: true,
  enabledByDefault: false,
  accent: "#C2903A",
  Component: lazy(() => import("./component")),
};
