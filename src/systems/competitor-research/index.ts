import { Radar } from "lucide-react";
import { lazy } from "react";
import type { SystemDefinition } from "../types";

export const competitorResearch: SystemDefinition = {
  key: "competitor-research",
  name: "Competitor Research",
  icon: Radar,
  tagline: "Scrape and analyse competitor Meta ads — code-native.",
  description:
    "Track competitors on Meta — scraping their live ads, owning the media, scoring duplicates, and breaking each ad down with AI into reusable strategic insight. Runs entirely in code (Apify + Gemini + Claude), no n8n.",
  capabilities: [
    "Meta Ad Library scraper (page-id or keyword)",
    "Media saved to your own storage",
    "Per-ad AI breakdown (angle, hooks, persona, proof)",
    "Dedup across runs",
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
