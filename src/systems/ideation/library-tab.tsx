"use client";

import { useMemo, useState } from "react";
import { Loader2, AlertTriangle, Lightbulb } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AngleCard } from "./angle-card";
import type { IdeationAngle, IdeationBatch } from "./ui-types";

const STATUS_FILTERS = ["all", "draft", "shortlisted", "approved", "sent_to_brief"] as const;
const FORMAT_FILTERS = ["all", "static", "carousel", "video"] as const;
const COMPLIANCE_FILTERS = ["all", "safe", "risky", "banned"] as const;

const pill = (active: boolean) =>
  cn("rounded-full border px-2.5 py-1 text-xs capitalize transition-colors", active ? "border-accent bg-accent/12 text-accent" : "border-input text-muted-foreground hover:bg-muted");

export function LibraryTab({ brandId, angles, batches, loaded, reload }: { brandId: string; angles: IdeationAngle[]; batches: IdeationBatch[]; loaded: boolean; reload: () => void }) {
  const [status, setStatus] = useState<string>("all");
  const [format, setFormat] = useState<string>("all");
  const [compliance, setCompliance] = useState<string>("all");

  const filtered = useMemo(
    () =>
      angles.filter(
        (a) =>
          (status === "all" || a.status === status) &&
          (format === "all" || a.format === format) &&
          (compliance === "all" || a.complianceFlag === compliance)
      ),
    [angles, status, format, compliance]
  );

  const active = batches.filter((b) => b.status === "pending" || b.status === "running");
  const failed = batches.filter((b) => b.status === "failed").slice(0, 1);

  if (!loaded) return <div className="h-64 animate-pulse rounded-[var(--radius)] bg-muted/50" />;

  if (angles.length === 0 && active.length === 0) {
    return (
      <BentoCard className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-accent/12 text-accent"><Lightbulb className="size-6" /></span>
        <p className="font-display text-lg font-medium">No angles yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">Head to the Create tab to generate your first bank of on-brand angles{failed.length ? " — the last batch failed, try again." : "."}</p>
      </BentoCard>
    );
  }

  return (
    <div className="space-y-4">
      {active.length > 0 && (
        <div className="flex items-center gap-2 rounded-2xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-foreground/80">
          <Loader2 className="size-4 animate-spin text-warning" /> Generating {active.reduce((n, b) => n + b.count, 0)} angles across {active.length} batch{active.length > 1 ? "es" : ""}…
        </div>
      )}
      {failed.length > 0 && (
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-foreground/80">
          <AlertTriangle className="size-4 text-destructive" /> A batch failed{failed[0].errorMessage ? `: ${failed[0].errorMessage}` : ""}. Try again from Create.
        </div>
      )}

      {/* filters */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterRow label="Status" options={STATUS_FILTERS} value={status} onChange={setStatus} />
        <FilterRow label="Format" options={FORMAT_FILTERS} value={format} onChange={setFormat} />
        <FilterRow label="Compliance" options={COMPLIANCE_FILTERS} value={compliance} onChange={setCompliance} />
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No angles match these filters.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((a) => <AngleCard key={a.id} brandId={brandId} angle={a} onChange={reload} />)}
        </div>
      )}
    </div>
  );
}

function FilterRow({ label, options, value, onChange }: { label: string; options: readonly string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</span>
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)} className={pill(value === o)}>{o.replace(/_/g, " ")}</button>
      ))}
    </div>
  );
}
