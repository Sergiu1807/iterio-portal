"use client";

import { useEffect, useState } from "react";
import { BentoCard } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Bucket = { key: string; cost: number; events: number };
type Rollup = {
  total: number;
  events: number;
  byProvider: Bucket[];
  bySystem: Bucket[];
  byKey: Bucket[];
  byBrand: Bucket[];
};

const WINDOWS = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];

export function UsageDashboard() {
  const [days, setDays] = useState(7);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/usage?days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRollup(d?.rollup ?? null))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/60 p-1">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              onClick={() => setDays(w.days)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-all",
                days === w.days ? "bg-card text-foreground shadow-[var(--shadow-xs)]" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
        {rollup && (
          <div className="ml-auto text-right">
            <div className="font-display text-2xl font-semibold tabular-nums">${rollup.total.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{rollup.events} calls</div>
          </div>
        )}
      </div>

      {loading || !rollup ? (
        <div className="h-64 animate-pulse rounded-[var(--radius)] bg-muted/50" />
      ) : rollup.events === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
          No usage recorded in this window yet. Spend appears here as systems make calls.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Breakdown title="By provider" buckets={rollup.byProvider} total={rollup.total} />
          <Breakdown title="By system" buckets={rollup.bySystem} total={rollup.total} />
          <Breakdown title="By key" buckets={rollup.byKey} total={rollup.total} />
          <Breakdown title="By brand" buckets={rollup.byBrand} total={rollup.total} />
        </div>
      )}
    </div>
  );
}

function Breakdown({ title, buckets, total }: { title: string; buckets: Bucket[]; total: number }) {
  return (
    <BentoCard className="p-6">
      <h3 className="mb-4 font-display text-base font-medium tracking-tight">{title}</h3>
      <div className="space-y-3">
        {buckets.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
        {buckets.map((b) => {
          const pct = total > 0 ? Math.round((b.cost / total) * 100) : 0;
          return (
            <div key={b.key}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="truncate font-medium">{b.key}</span>
                <span className="tabular-nums text-muted-foreground">${b.cost.toFixed(2)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </BentoCard>
  );
}
