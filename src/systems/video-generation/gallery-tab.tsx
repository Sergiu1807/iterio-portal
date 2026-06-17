"use client";

import { useMemo, useState } from "react";
import { Film } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VideoGen } from "./ui-types";
import { VideoTile } from "./result-tile";
import { modeLabel } from "./ui-utils";

const STATUS_FILTERS = ["all", "completed", "generating", "error"] as const;

export function GalleryTab({ generations, reload }: { generations: VideoGen[]; reload: () => void }) {
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");

  const filtered = useMemo(
    () =>
      generations.filter((g) => {
        if (status === "all") return true;
        if (status === "generating") return g.status === "pending" || g.status === "generating";
        return g.status === status;
      }),
    [generations, status]
  );

  const groups = useMemo(() => {
    const out: { key: string; items: VideoGen[] }[] = [];
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
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/60 p-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium capitalize transition-all",
                status === s ? "bg-card text-foreground shadow-[var(--shadow-xs)]" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} video{filtered.length === 1 ? "" : "s"}</span>
      </div>

      {groups.length === 0 ? (
        <div className="results-canvas flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            <Film className="size-6" />
          </span>
          <p className="max-w-xs text-sm text-muted-foreground">No videos yet. Generate some from the Create tab and they’ll collect here.</p>
        </div>
      ) : (
        <div className="space-y-7">
          {groups.map((grp) => {
            const head = grp.items[0];
            const date = new Date(head.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
            return (
              <div key={grp.key} className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{modeLabel(head)}</span>
                  <span>· {grp.items.length} video{grp.items.length === 1 ? "" : "s"}</span>
                  <span>· {date}</span>
                  <span className="ml-1 h-px flex-1 bg-border/60" />
                </div>
                <div className="stagger grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
                  {grp.items.map((g) => (
                    <VideoTile key={g.id} gen={g} onReload={reload} />
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
