"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Generation } from "./ui-types";
import { GenTile } from "./result-tile";
import { modeLabel } from "./ui-utils";

const STATUS_FILTERS = ["all", "completed", "generating", "error"] as const;

export function GalleryTab({
  generations,
  reload,
  renderActions,
}: {
  generations: Generation[];
  reload: () => void;
  renderActions?: (gen: Generation) => React.ReactNode;
}) {
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");

  const filtered = useMemo(() => {
    return generations.filter((g) => {
      if (status === "all") return true;
      if (status === "generating") return g.status === "pending" || g.status === "generating";
      return g.status === status;
    });
  }, [generations, status]);

  // Group consecutive items by batch (generations arrive newest-first).
  const groups = useMemo(() => {
    const out: { key: string; items: Generation[] }[] = [];
    for (const g of filtered) {
      const key = g.batchId ?? g.id;
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(g);
      else out.push({ key, items: [g] });
    }
    for (const grp of out) grp.items.sort((a, b) => a.batchIndex - b.batchIndex);
    return out;
  }, [filtered]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
              status === s ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} image{filtered.length === 1 ? "" : "s"}</span>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
          Nothing here yet. Generate some ads from the Create tab.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((grp) => {
            const head = grp.items[0];
            const date = new Date(head.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
            return (
              <div key={grp.key} className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{modeLabel(head.mode)}</span>
                  <span>· {grp.items.length} image{grp.items.length === 1 ? "" : "s"}</span>
                  <span>· {date}</span>
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                  {grp.items.map((g) => (
                    <GenTile key={g.id} gen={g} onReload={reload} actions={renderActions} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
