import { Radar } from "lucide-react";
import type { SystemDefinition } from "../types";

export const competitorResearch: SystemDefinition = {
  key: "competitor-research",
  name: "Competitor Research",
  icon: Radar,
  tagline: "Scrape and analyse competitor ads, organic and angles.",
  description:
    "Track competitors across Meta, TikTok and Instagram — scraping their ads and organic content, scoring longevity, and surfacing the angles working in this brand's category. Feeds research-grounded briefs.",
  capabilities: [
    "Meta / TikTok / Instagram scrapers",
    "Ad longevity scoring + copy breakdown",
    "AI angle & creative analysis",
    "Research-grounded brief handoff",
  ],
  status: "placeholder",
  nav: { group: "research", order: 10 },
  infra: [
    { kind: "n8n", workflowKey: "competitor_research", label: "n8n workflow" },
    { kind: "service", keyName: "APIFY_TOKEN", label: "Apify (scrapers)" },
    { kind: "apiKey", keyName: "ANTHROPIC_API_KEY", label: "Anthropic Claude" },
  ],
  perBrand: true,
  enabledByDefault: false,
  accent: "#B58A3C",
};
