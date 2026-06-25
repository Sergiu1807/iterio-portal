import { lazy } from "react";
import { FileText } from "lucide-react";
import type { SystemDefinition } from "../types";

export const briefGeneration: SystemDefinition = {
  key: "brief-generation",
  name: "Brief Generation",
  icon: FileText,
  tagline: "Turn an approved angle into a production-ready brief.",
  description:
    "Expand an approved angle into a complete, production-ready brief — full video script + scene-by-scene shot list, or per-frame static/carousel visual spec — grounded in this brand's B3, with compliance carried through to production.",
  capabilities: [
    "Video script + scene-by-scene shot list",
    "Per-frame static / carousel visual spec",
    "Recreate a competitor winner on-brand",
    "Compliance carried through · one-click to copy + production",
  ],
  status: "live",
  nav: { group: "create", order: 15 },
  infra: [{ kind: "apiKey", keyName: "ANTHROPIC_API_KEY", label: "Anthropic Claude" }],
  perBrand: true,
  enabledByDefault: false,
  accent: "#5A7A64",
  Component: lazy(() => import("./component")),
};
