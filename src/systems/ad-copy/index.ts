import { lazy } from "react";
import { PenSquare } from "lucide-react";
import type { SystemDefinition } from "../types";

export const adCopy: SystemDefinition = {
  key: "ad-copy",
  name: "Ad Copy",
  icon: PenSquare,
  tagline: "Launch-ready in-feed copy — primary text, headline, CTA — off an angle or brief.",
  description:
    "Generate the in-feed ad copy that ships with each creative: brand-voice primary text, headline and CTA variants, persona-targeted and compliance-pre-screened — straight off an approved angle or a completed brief.",
  capabilities: [
    "Distinct variants (different lead each), not synonyms",
    "Primary text · headline · CTA per placement",
    "Brand voice + customers' own words",
    "Compliance pre-screened (model + deterministic scan)",
  ],
  status: "live",
  nav: { group: "create", order: 17 },
  infra: [{ kind: "apiKey", keyName: "ANTHROPIC_API_KEY", label: "Anthropic Claude" }],
  perBrand: true,
  enabledByDefault: false,
  accent: "#7C6BA8",
  Component: lazy(() => import("./component")),
};
