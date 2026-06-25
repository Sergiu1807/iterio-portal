"use client";

import { useMemo, useState } from "react";
import { Loader2, PenSquare } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CopyCard } from "./copy-card";
import type { AdCopy, AdCopyBatch } from "./ui-types";

const STATUS = ["all", "draft", "approved"] as const;
const PLACEMENT = ["all", "feed", "reels", "story"] as const;
const COMPLIANCE = ["all", "safe", "risky", "banned"] as const;
const pill = (a: boolean) => cn("rounded-full border px-2.5 py-1 text-xs capitalize transition-colors", a ? "border-accent bg-accent/12 text-accent" : "border-input text-muted-foreground hover:bg-muted");

export function LibraryTab({ brandId, copy, batches, loaded, reload }: { brandId: string; copy: AdCopy[]; batches: AdCopyBatch[]; loaded: boolean; reload: () => void }) {
  const [status, setStatus] = useState("all");
  const [placement, setPlacement] = useState("all");
  const [compliance, setCompliance] = useState("all");
  const filtered = useMemo(() => copy.filter((c) => (status === "all" || c.status === status) && (placement === "all" || c.placement === placement) && (compliance === "all" || c.complianceFlag === compliance)), [copy, status, placement, compliance]);
  const active = batches.filter((b) => b.status === "pending" || b.status === "running");

  if (!loaded) return <div className="h-64 animate-pulse rounded-[var(--radius)] bg-muted/50" />;
  if (copy.length === 0 && active.length === 0) {
    return (
      <BentoCard className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-accent/12 text-accent"><PenSquare className="size-6" /></span>
        <p className="font-display text-lg font-medium">No copy yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">Generate copy from an approved angle or a completed brief in the Create tab — or hit “Copy” on a brief.</p>
      </BentoCard>
    );
  }

  return (
    <div className="space-y-4">
      {active.length > 0 && <div className="flex items-center gap-2 rounded-2xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-foreground/80"><Loader2 className="size-4 animate-spin text-warning" /> Generating copy variants…</div>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Status</span>{STATUS.map((s) => <button key={s} onClick={() => setStatus(s)} className={pill(status === s)}>{s}</button>)}</div>
        <div className="flex items-center gap-1.5"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Placement</span>{PLACEMENT.map((p) => <button key={p} onClick={() => setPlacement(p)} className={pill(placement === p)}>{p}</button>)}</div>
        <div className="flex items-center gap-1.5"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Compliance</span>{COMPLIANCE.map((c) => <button key={c} onClick={() => setCompliance(c)} className={pill(compliance === c)}>{c}</button>)}</div>
      </div>
      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No copy matches these filters.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((c) => <CopyCard key={c.id} copy={c} onChange={reload} />)}</div>
      )}
    </div>
  );
}
