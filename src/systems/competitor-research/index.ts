import { Radar } from "lucide-react";
import { lazy } from "react";
import type { SystemDefinition } from "../types";

export const competitorResearch: SystemDefinition = {
  key: "competitor-research",
  name: "Competitor Research",
  icon: Radar,
  tagline: "A competitive creative radar — scrape, score and deconstruct competitor Meta ads.",
  description:
    "Track competitors on Meta — scraping their live ads, owning the media, clustering variants into concepts, ranking each by a composite Winner Score, and breaking the winners down into a structured Angle Bank. Runs entirely in code (Apify + Gemini + Claude), no n8n.",
  capabilities: [
    "Meta Ad Library scraper (URL, page-id or keyword)",
    "Variant clustering + composite Winner Score & tiers",
    "Structured Angle Bank teardown per concept",
    "Winner Board + swipe library",
  ],
  status: "live",
  nav: { group: "research", order: 10 },
  infra: [
    { kind: "service", keyName: "APIFY_TOKEN", label: "Apify (scraper)" },
    { kind: "apiKey", keyName: "GEMINI_API_KEY", label: "Google Gemini (vision)" },
    { kind: "apiKey", keyName: "ANTHROPIC_API_KEY", label: "Anthropic Claude" },
  ],
  perBrand: true,
  enabledByDefault: false,
  accent: "#B58A3C",
  Component: lazy(() => import("./component")),
};
