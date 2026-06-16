import type { InfraRequirement } from "@/systems/types";
import { SYSTEMS } from "@/systems/registry";

// Client-safe. Readiness is computed against a set of configured key names
// (provided by PortalMeta, sourced from the api_keys table + env).

export function infraReady(req: InfraRequirement, configured: Set<string>): boolean {
  if (req.kind === "n8n") return false; // this lab is n8n-free
  return configured.has(req.keyName);
}

export function infraStatus(
  reqs: InfraRequirement[],
  configured: Set<string>
): { req: InfraRequirement; ready: boolean }[] {
  return reqs.map((req) => ({ req, ready: infraReady(req, configured) }));
}

export function allInfraReady(reqs: InfraRequirement[], configured: Set<string>): boolean {
  return reqs.length === 0 || reqs.every((r) => infraReady(r, configured));
}

// ---- registry-derived key ↔ system mapping (no separate table needed) ----

function keyNameOf(req: InfraRequirement): string | null {
  return req.kind === "n8n" ? null : req.keyName;
}

export function keysForSystem(systemKey: string): string[] {
  const s = SYSTEMS.find((x) => x.key === systemKey);
  if (!s) return [];
  return s.infra.map(keyNameOf).filter((k): k is string => !!k);
}

export function systemsForKey(keyName: string): { key: string; name: string }[] {
  return SYSTEMS.filter((s) => s.infra.some((r) => keyNameOf(r) === keyName)).map((s) => ({
    key: s.key,
    name: s.name,
  }));
}
