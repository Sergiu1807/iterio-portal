"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Lock, Check, History } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BentoCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { IntelRow } from "./ui-types";

export function StepApprove({ row, brandId, onApproved }: { row: IntelRow; brandId: string; onApproved: () => void }) {
  const [versions, setVersions] = useState<IntelRow[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const gaps = row.gapsJson ?? [];

  useEffect(() => {
    fetch(`/api/brand-foundation/versions?brandId=${brandId}`)
      .then((r) => (r.ok ? r.json() : { versions: [] }))
      .then((d) => setVersions(d.versions ?? []))
      .catch(() => {});
  }, [brandId, row.version, row.status]);

  const approve = async () => {
    setBusy(true);
    const res = await fetch("/api/brand-foundation/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId, version: row.version }) });
    setBusy(false);
    setConfirm(false);
    if (res.ok) { toast.success(`B3 v${row.version} approved`, { description: "Now grounding every system." }); onApproved(); }
    else toast.error(((await res.json().catch(() => ({}))) as { error?: string })?.error ?? "Approve failed");
  };

  return (
    <div className="space-y-4">
      <BentoCard className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-base font-medium">Approve &amp; lock</h3>
          <Badge variant={row.status === "approved" ? "success" : "warning"}>{row.status} · v{row.version}</Badge>
        </div>
        {row.status === "approved" ? (
          <p className="text-sm text-muted-foreground">v{row.version} is live and grounds every system via the brand record. Use “Edit → new draft” on the Review step to revise.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Publishing locks this version and projects it into the brand so Static, Competitor Research and Video read it.</p>
            {gaps.length > 0 && <p className="text-xs text-warning">{gaps.length} gap{gaps.length === 1 ? "" : "s"} still flagged — you can approve anyway.</p>}
            <Button className="cta-glow" onClick={() => setConfirm(true)}>
              <Lock className="size-4" /> Publish B3 v{row.version}
            </Button>
          </>
        )}
      </BentoCard>

      {versions.length > 0 && (
        <BentoCard className="space-y-2 p-5">
          <h3 className="flex items-center gap-1.5 text-sm font-medium"><History className="size-4" /> Version history</h3>
          {versions.map((v) => (
            <div key={v.id} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">v{v.version}{v.approvedAt ? ` · approved ${new Date(v.approvedAt).toLocaleDateString()}` : ""}</span>
              <Badge variant={v.status === "approved" ? "success" : "muted"}>{v.status}</Badge>
            </div>
          ))}
        </BentoCard>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-md">
          <div className="space-y-4">
            <h2 className="font-display text-lg font-medium">Publish B3 v{row.version}?</h2>
            <p className="text-sm text-muted-foreground">
              This locks the version and updates the brand&apos;s grounding for every system.{gaps.length ? ` ${gaps.length} gap${gaps.length === 1 ? "" : "s"} remain.` : ""}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button onClick={approve} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Publish
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
