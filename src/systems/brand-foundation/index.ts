import { lazy } from "react";
import { Compass } from "lucide-react";
import type { SystemDefinition } from "../types";

export const brandFoundation: SystemDefinition = {
  key: "brand-foundation",
  name: "Brand Foundation",
  icon: Compass,
  tagline: "Onboard a brand and build its evidence-backed Brand Intelligence (B3).",
  description:
    "The foundation every other system reads. Add a brand's sources (website, Meta ads, competitors, reviews, Reddit, social, email), auto-research them, then synthesize, review and approve a versioned, confidence-scored Brand Intelligence (B3) profile that grounds Ideation, Static, Video and Competitor Research.",
  capabilities: [
    "Multi-source auto-research (website, reviews/VOC, Reddit, social, compliance)",
    "Versioned B3 with per-field confidence + gap flags + evidence links",
    "Review/edit/approve → projects into the brand the whole portal reads",
    "Ingredient-vision, verbatim VOC, version diffing",
  ],
  status: "live",
  nav: { group: "foundation", order: 10 },
  infra: [
    { kind: "apiKey", keyName: "ANTHROPIC_API_KEY", label: "Anthropic Claude" },
    { kind: "apiKey", keyName: "GEMINI_API_KEY", label: "Google Gemini (vision)" },
    { kind: "service", keyName: "APIFY_TOKEN", label: "Apify (review/social scrapers)" },
  ],
  perBrand: false,
  enabledByDefault: true,
  accent: "#5A7A64",
  Component: lazy(() => import("./workspace")),
};
