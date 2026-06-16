import type { InfraRequirement } from "@/systems/types";

/**
 * Frontend prototype: mock which integrations are "configured". In the real
 * build this resolves against the encrypted api_keys table + app_config.workflows.
 * Anthropic is treated as configured so Brief Generation reads as ready and the
 * others show an accurate "Needs setup" badge.
 */
const CONFIGURED_KEYS = new Set<string>(["ANTHROPIC_API_KEY"]);
const CONFIGURED_N8N = new Set<string>(); // none wired in the prototype

export function infraReady(req: InfraRequirement): boolean {
  if (req.kind === "n8n") return CONFIGURED_N8N.has(req.workflowKey);
  return CONFIGURED_KEYS.has(req.keyName);
}

export function infraStatus(reqs: InfraRequirement[]): { req: InfraRequirement; ready: boolean }[] {
  return reqs.map((req) => ({ req, ready: infraReady(req) }));
}

export function allInfraReady(reqs: InfraRequirement[]): boolean {
  return reqs.length === 0 || reqs.every(infraReady);
}

export function reqLabel(req: InfraRequirement): string {
  return req.label;
}
