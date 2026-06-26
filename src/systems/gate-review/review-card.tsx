"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Check, X, RefreshCw, Trash2, ShieldCheck, ShieldX, UserCheck, AlertTriangle } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GateReview } from "./ui-types";

export function ReviewCard({ review, reload }: { review: GateReview; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const running = review.status === "pending" || review.status === "running";
  const pass = review.overallPass === true;

  const override = async (overallPass: boolean) => {
    setBusy(true);
    const r = await fetch(`/api/systems/gate-review/reviews/${review.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ overallPass }) });
    setBusy(false);
    if (r.ok) { toast.success(`Overridden → ${overallPass ? "pass" : "fail"}`); reload(); } else toast.error("Override failed");
  };
  const regen = async () => { setBusy(true); const r = await fetch(`/api/systems/gate-review/reviews/${review.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "regenerate" }) }); setBusy(false); if (r.ok) { toast.success("Re-grading…"); reload(); } else toast.error("Failed"); };
  const del = async () => { setBusy(true); const r = await fetch(`/api/systems/gate-review/reviews/${review.id}`, { method: "DELETE" }); setBusy(false); if (r.ok) { toast.success("Deleted"); reload(); } else toast.error("Failed"); };

  return (
    <BentoCard className={cn("flex flex-col gap-2.5 overflow-hidden p-0", review.status === "complete" && (pass ? "border-success/40" : "border-destructive/40"))}>
      <div className="flex gap-3 p-3">
        <div className="size-20 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted">
          {review.assetUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={review.assetUrl} alt="creative" className="size-full object-cover" />
          ) : <span className="flex size-full items-center justify-center text-[9px] text-muted-foreground">no preview</span>}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {running ? (
              <Badge variant="warning" className="gap-1"><Loader2 className="size-3 animate-spin" /> grading…</Badge>
            ) : review.status === "failed" ? (
              <Badge variant="outline" className="border-destructive/40 text-destructive">error</Badge>
            ) : pass ? (
              <Badge variant="success" className="gap-1"><ShieldCheck className="size-3" /> Passed the gate</Badge>
            ) : (
              <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive"><ShieldX className="size-3" /> Needs work</Badge>
            )}
            <Badge variant="muted" className="gap-1">{review.reviewer === "human" ? <><UserCheck className="size-3" /> human</> : "AI"}{review.overridden ? " · overridden" : ""}</Badge>
            <span className="text-[11px] text-muted-foreground">{review.sourceSystem}{review.b3Version ? ` · B3 v${review.b3Version}` : ""}{review.costCents ? ` · ${review.costCents}¢` : ""}</span>
          </div>
          {review.status === "failed" && review.errorMessage && <p className="text-xs text-warning">{review.errorMessage}</p>}
        </div>
      </div>

      {review.status === "complete" && review.criteriaJson.length > 0 && (
        <div className="space-y-1 px-3">
          {review.criteriaJson.map((c) => (
            <div key={c.key} className="flex items-start gap-2 text-xs">
              <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full", c.pass ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                {c.pass ? <Check className="size-2.5" /> : <X className="size-2.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground/85">{c.label}</span>
                  <span className={cn("font-mono text-[11px]", c.pass ? "text-success" : "text-destructive")}>{c.score}</span>
                </div>
                {c.note && <p className="text-[11px] leading-snug text-muted-foreground">{c.note}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {review.status === "complete" && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border/50 p-2">
          {!pass && <Button size="sm" variant="ghost" className="text-success" onClick={() => override(true)} disabled={busy} title="Override → pass"><Check className="size-3.5" /> Pass anyway</Button>}
          {pass && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => override(false)} disabled={busy} title="Override → fail"><X className="size-3.5" /> Fail it</Button>}
          {!pass && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><AlertTriangle className="size-3 text-warning" /> fix &amp; re-gate before shipping</span>}
          <Button size="sm" variant="ghost" onClick={regen} disabled={busy} title="Re-grade"><RefreshCw className="size-3.5" /></Button>
          <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={del} disabled={busy} title="Delete"><Trash2 className="size-3.5" /></Button>
        </div>
      )}
    </BentoCard>
  );
}
