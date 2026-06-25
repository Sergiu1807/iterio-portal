import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

export type SystemStatus = "placeholder" | "live";
export type NavGroup = "foundation" | "create" | "research" | "ops";

/**
 * What a system needs to actually function. The dashboard reads this to show an
 * accurate "Needs setup" badge — declared up-front even for placeholder systems.
 */
export type InfraRequirement =
  | { kind: "apiKey"; keyName: string; label: string }
  | { kind: "service"; keyName: string; label: string }
  | { kind: "n8n"; workflowKey: string; label: string };

export interface SystemDefinition {
  /** stable slug → URL (/s/<key>) + per-brand settings key */
  key: string;
  name: string;
  icon: LucideIcon;
  /** one-liner for cards */
  tagline: string;
  /** longer copy for the placeholder hero */
  description: string;
  /** what this system will be able to do, once live */
  capabilities: string[];
  status: SystemStatus;
  nav: { group: NavGroup; order: number; hidden?: boolean };
  infra: InfraRequirement[];
  perBrand?: boolean;
  enabledByDefault?: boolean;
  /** per-system accent hex (kept within the Soft Canvas warm range) */
  accent: string;
  /** wired only when status flips to "live" — placeholders need none */
  Component?: ComponentType<{ brandId: string }>;
}

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  foundation: "Foundation",
  create: "Create",
  research: "Research",
  ops: "Operations",
};
