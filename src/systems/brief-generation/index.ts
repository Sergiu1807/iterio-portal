import { FileText } from "lucide-react";
import type { SystemDefinition } from "../types";

export const briefGeneration: SystemDefinition = {
  key: "brief-generation",
  name: "Brief Generation",
  icon: FileText,
  tagline: "Turn brand intelligence into production-ready creative briefs.",
  description:
    "Generate structured creative briefs — hooks, angles, shot lists and guardrails — grounded in this brand's intelligence, products and personas. Each brief is built to hand straight to a creator or editor.",
  capabilities: [
    "Hook + angle variations per psychology lever",
    "Shot lists and camera direction",
    "Compliance + brand-voice guardrails baked in",
    "One-click handoff to production",
  ],
  status: "placeholder",
  nav: { group: "create", order: 15 },
  infra: [{ kind: "apiKey", keyName: "ANTHROPIC_API_KEY", label: "Anthropic Claude" }],
  perBrand: true,
  enabledByDefault: true,
  accent: "#5A7A64",
};
