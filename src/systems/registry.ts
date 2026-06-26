import type { NavGroup, SystemDefinition } from "./types";
import { brandFoundation } from "./brand-foundation";
import { ideation } from "./ideation";
import { briefGeneration } from "./brief-generation";
import { adCopy } from "./ad-copy";
import { staticGeneration } from "./static-generation";
import { videoGeneration } from "./video-generation";
import { competitorResearch } from "./competitor-research";
import { gateReview } from "./gate-review";

/**
 * Single source of truth. The sidebar, dashboard, command palette and the
 * generic /s/[systemKey] route all render from this array — so adding a system
 * (or flipping one from placeholder → live) is a registry edit, not a shell
 * refactor.
 */
export const SYSTEMS: SystemDefinition[] = [
  brandFoundation,
  ideation,
  briefGeneration,
  adCopy,
  staticGeneration,
  videoGeneration,
  competitorResearch,
  gateReview,
];

export function getSystem(key: string): SystemDefinition | null {
  return SYSTEMS.find((s) => s.key === key) ?? null;
}

export function navSystems(): SystemDefinition[] {
  return SYSTEMS.filter((s) => !s.nav.hidden).sort((a, b) => a.nav.order - b.nav.order);
}

export function systemsByGroup(): { group: NavGroup; systems: SystemDefinition[] }[] {
  const groups: NavGroup[] = ["foundation", "create", "research", "ops"];
  return groups
    .map((group) => ({ group, systems: navSystems().filter((s) => s.nav.group === group) }))
    .filter((g) => g.systems.length > 0);
}
