import { Image } from "lucide-react";
import type { SystemDefinition } from "../types";

export const staticGeneration: SystemDefinition = {
  key: "static-generation",
  name: "Static Generation",
  icon: Image,
  tagline: "On-brand static ads from your products and visual direction.",
  description:
    "Generate static ad creative that matches this brand's palette, voice and visual direction — straight from the product catalog and brand intelligence. Browse references, generate variations, and edit copy in place.",
  capabilities: [
    "Multi-variation generation per concept",
    "Feed + story crops in one pass",
    "Reference & winners libraries",
    "In-place copy editing",
  ],
  status: "placeholder",
  nav: { group: "create", order: 20 },
  infra: [
    { kind: "apiKey", keyName: "ANTHROPIC_API_KEY", label: "Anthropic Claude" },
    { kind: "service", keyName: "KIE_AI_API_KEY", label: "Kie AI (image generation)" },
  ],
  perBrand: true,
  enabledByDefault: false,
  accent: "#C2785A",
};
