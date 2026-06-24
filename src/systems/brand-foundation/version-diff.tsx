"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { diffB3, diffSummary, type DiffEntry } from "./b3-diff";
import type { IntelRow } from "./ui-types";

const selectCls = "h-9 rounded-xl border border-input bg-background/60 px-3 text-sm";

function trunc(s: string | undefined, n = 140): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function VersionDiff({ versions }: { versions: IntelRow[] }) {
  const sorted = useMemo(() => [...versions].sort((a, b) => b.version - a.version), [versions]);
  const [baseV, setBaseV] = useState<number>(sorted[1]?.version ?? sorted[0]?.version ?? 1);
  const [targetV, setTargetV] = useState<number>(sorted[0]?.version ?? 1);

  const base = sorted.find((v) => v.version === baseV);
  const target = sorted.find((v) => v.version === targetV);
  const entries = useMemo(() => (base && target ? diffB3(base.json, target.json) : []), [base, target]);
  const summary = diffSummary(entries);
  const bySection = useMemo(() => {
    const m = new Map<string, DiffEntry[]>();
    for (const e of entries) { const a = m.get(e.section) ?? []; a.push(e); m.set(e.section, a); }
    return [...m.entries()];
  }, [entries]);

  if (sorted.length < 2) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Compare</span>
        <select value={baseV} onChange={(e) => setBaseV(Number(e.target.value))} className={selectCls}>
          {sorted.map((v) => <option key={v.id} value={v.version}>v{v.version} {v.status === "approved" ? "✓" : "draft"}</option>)}
        </select>
        <span className="text-muted-foreground">→</span>
        <select value={targetV} onChange={(e) => setTargetV(Number(e.target.value))} className={selectCls}>
          {sorted.map((v) => <option key={v.id} value={v.version}>v{v.version} {v.status === "approved" ? "✓" : "draft"}</option>)}
        </select>
        <div className="ml-auto flex gap-1.5">
          {summary.added > 0 && <Badge variant="success">+{summary.added}</Badge>}
          {summary.removed > 0 && <Badge variant="outline" className="border-destructive/40 text-destructive">−{summary.removed}</Badge>}
          {summary.changed > 0 && <Badge variant="warning">~{summary.changed}</Badge>}
        </div>
      </div>

      {baseV === targetV ? (
        <p className="text-sm text-muted-foreground">Pick two different versions to compare.</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No content differences between v{baseV} and v{targetV}.</p>
      ) : (
        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {bySection.map(([section, items]) => (
            <div key={section} className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.replace(/_/g, " ")}</p>
              {items.map((e, i) => {
                const sub = e.path.replace(new RegExp(`^${section}\\.?`), "") || "(root)";
                return (
                  <div key={i} className="rounded-lg border border-border/60 bg-muted/30 p-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className={e.kind === "added" ? "text-success" : e.kind === "removed" ? "text-destructive" : "text-warning"}>
                        {e.kind === "added" ? "+ added" : e.kind === "removed" ? "− removed" : "~ changed"}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">{sub}</span>
                    </div>
                    {e.kind === "changed" ? (
                      <div className="mt-1 space-y-0.5">
                        <p className="text-destructive/80 line-through">{trunc(e.before)}</p>
                        <p className="text-success/90">{trunc(e.after)}</p>
                      </div>
                    ) : (
                      <p className={`mt-1 ${e.kind === "removed" ? "text-destructive/80 line-through" : "text-foreground/85"}`}>{trunc(e.kind === "added" ? e.after : e.before)}</p>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
