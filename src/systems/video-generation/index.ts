import { Clapperboard } from "lucide-react";
import type { SystemDefinition } from "../types";

export const videoGeneration: SystemDefinition = {
  key: "video-generation",
  name: "Video Generation",
  icon: Clapperboard,
  tagline: "UGC, B-roll and A-roll video built from your brand.",
  description:
    "Produce short-form video creative — UGC product demos, B-roll and talking-head A-roll — driven by this brand's products, characters and scenes. Track generations and reuse characters across spots.",
  capabilities: [
    "UGC (product, product + character, no-ref)",
    "B-roll and A-roll modes",
    "Characters & scenes libraries",
    "Live generation progress tracker",
  ],
  status: "placeholder",
  nav: { group: "create", order: 30 },
  infra: [
    { kind: "apiKey", keyName: "ANTHROPIC_API_KEY", label: "Anthropic Claude" },
    { kind: "service", keyName: "OPENAI_API_KEY", label: "OpenAI" },
    { kind: "service", keyName: "KIE_AI_API_KEY", label: "Kie AI (Seedance video)" },
  ],
  perBrand: true,
  enabledByDefault: false,
  accent: "#6E5A86",
};
