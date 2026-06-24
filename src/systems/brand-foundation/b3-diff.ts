import type { B3 } from "./b3-schema";

export type DiffKind = "added" | "removed" | "changed";
export type DiffEntry = { path: string; section: string; before?: string; after?: string; kind: DiffKind };

// Machine churn — never surface in a content diff.
const SKIP = /^meta\.(generated_at|version|source_refs|confidence_scores)/;

/** Flatten a nested object to leaf paths → string values (arrays indexed; empties marked). */
function flatten(obj: unknown, prefix: string, out: Record<string, string>): Record<string, string> {
  if (obj === null || obj === undefined) return out;
  if (Array.isArray(obj)) {
    if (obj.length === 0) { if (prefix) out[prefix] = "(empty)"; return out; }
    obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof obj === "object") {
    const keys = Object.keys(obj as Record<string, unknown>);
    if (keys.length === 0) { if (prefix) out[prefix] = "(empty)"; return out; }
    for (const k of keys) flatten((obj as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out[prefix] = String(obj);
  return out;
}

/** Structured diff between two B3 objects (content only — meta churn excluded). */
export function diffB3(a: B3, b: B3): DiffEntry[] {
  const fa = flatten(a, "", {});
  const fb = flatten(b, "", {});
  const paths = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  const entries: DiffEntry[] = [];
  for (const p of paths) {
    if (SKIP.test(p)) continue;
    const before = fa[p];
    const after = fb[p];
    if (before === after) continue;
    const section = p.split(/[.[]/)[0];
    if (before === undefined) entries.push({ path: p, section, after, kind: "added" });
    else if (after === undefined) entries.push({ path: p, section, before, kind: "removed" });
    else entries.push({ path: p, section, before, after, kind: "changed" });
  }
  return entries.sort((x, y) => x.section.localeCompare(y.section) || x.path.localeCompare(y.path));
}

export function diffSummary(entries: DiffEntry[]): { added: number; removed: number; changed: number } {
  return {
    added: entries.filter((e) => e.kind === "added").length,
    removed: entries.filter((e) => e.kind === "removed").length,
    changed: entries.filter((e) => e.kind === "changed").length,
  };
}
