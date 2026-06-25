"use client";

import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BriefView } from "./brief-view";
import type { Brief } from "./ui-types";

const STATUS_FILTERS = ["all", "complete", "approved", "pending", "failed"] as const;
const FORMAT_FILTERS = ["all", "video", "static", "carousel"] as const;
const pill = (active: boolean) => cn("rounded-full border px-2.5 py-1 text-xs capitalize transition-colors", active ? "border-accent bg-accent/12 text-accent" : "border-input text-muted-foreground hover:bg-muted");

export function LibraryTab({ brandId, briefs, loaded, reload }: { brandId: string; briefs: Brief[]; loaded: boolean; reload: () => void }) {
  const [status, setStatus] = useState("all");
  const [format, setFormat] = useState("all");
  const filtered = useMemo(() => briefs.filter((b) => (status === "all" || b.status === status) && (format === "all" || b.format === format)), [briefs, status, format]);

  if (!loaded) return <div className="h-64 animate-pulse rounded-[var(--radius)] bg-muted/50" />;
  if (briefs.length === 0) {
    return (
      <BentoCard className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-accent/12 text-accent"><FileText className="size-6" /></span>
        <p className="font-display text-lg font-medium">No briefs yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">Pick an approved angle in Create — or hit “Send to brief” from the Ideation library — to generate your first production-ready brief.</p>
      </BentoCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Status</span>{STATUS_FILTERS.map((s) => <button key={s} onClick={() => setStatus(s)} className={pill(status === s)}>{s}</button>)}</div>
        <div className="flex items-center gap-1.5"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Format</span>{FORMAT_FILTERS.map((f) => <button key={f} onClick={() => setFormat(f)} className={pill(format === f)}>{f}</button>)}</div>
      </div>
      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No briefs match these filters.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((b) => <BriefView key={b.id} brandId={brandId} brief={b} reload={reload} />)}
        </div>
      )}
    </div>
  );
}
