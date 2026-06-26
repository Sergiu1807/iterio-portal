"use client";

import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ReviewCard } from "./review-card";
import type { GateReview } from "./ui-types";

const FILTERS = ["all", "pass", "fail", "running"] as const;
const pill = (a: boolean) => cn("rounded-full border px-2.5 py-1 text-xs capitalize transition-colors", a ? "border-accent bg-accent/12 text-accent" : "border-input text-muted-foreground hover:bg-muted");

export function ReviewTab({ brandId, reviews, loaded, reload }: { brandId: string; reviews: GateReview[]; loaded: boolean; reload: () => void }) {
  const [filter, setFilter] = useState<string>("all");
  const filtered = useMemo(() => reviews.filter((r) => {
    if (filter === "pass") return r.overallPass === true;
    if (filter === "fail") return r.status === "complete" && r.overallPass === false;
    if (filter === "running") return r.status === "pending" || r.status === "running";
    return true;
  }), [reviews, filter]);

  const passed = reviews.filter((r) => r.overallPass === true).length;
  const failed = reviews.filter((r) => r.status === "complete" && r.overallPass === false).length;

  if (!loaded) return <div className="h-64 animate-pulse rounded-[var(--radius)] bg-muted/50" />;
  if (reviews.length === 0) {
    return (
      <BentoCard className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-accent/12 text-accent"><ShieldCheck className="size-6" /></span>
        <p className="font-display text-lg font-medium">Nothing gated yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">Send a produced creative through the gate — every asset is scored on-brand · doesn&apos;t-look-AI · compliant · hook · clarity · angle integrity before it ships.</p>
      </BentoCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Show</span>
          {FILTERS.map((f) => <button key={f} onClick={() => setFilter(f)} className={pill(filter === f)}>{f}</button>)}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{passed} passed · {failed} need work</span>
      </div>
      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No reviews match.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{filtered.map((r) => <ReviewCard key={r.id} review={r} reload={reload} />)}</div>
      )}
    </div>
  );
}
