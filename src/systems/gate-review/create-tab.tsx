"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Link2 } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Reviewable } from "./ui-types";

type Grounding = { source: "b3" | "flat" | "none"; version: number | null; hasCompliance: boolean };

export function CreateTab({ brandId, onGated }: { brandId: string; onGated: () => void }) {
  const [items, setItems] = useState<Reviewable[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [externalUrl, setExternalUrl] = useState("");
  const [grounding, setGrounding] = useState<Grounding | null>(null);

  useEffect(() => {
    fetch(`/api/systems/gate-review/reviewable?brandId=${brandId}`).then((r) => (r.ok ? r.json() : { reviewable: [] })).then((d: { reviewable: Reviewable[] }) => setItems(d.reviewable ?? [])).catch(() => {});
    fetch(`/api/systems/ideation/grounding?brandId=${brandId}`).then((r) => (r.ok ? r.json() : null)).then((d) => setGrounding(d)).catch(() => {});
  }, [brandId]);

  const gate = async (body: Record<string, unknown>, key: string) => {
    setBusyId(key);
    const res = await fetch(`/api/systems/gate-review/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId, ...body }) });
    setBusyId(null);
    if (res.ok) { toast.success("Grading the creative against the scorecard…"); onGated(); }
    else toast.error(((await res.json().catch(() => ({}))) as { error?: string })?.error ?? "Couldn't start the gate");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BentoCard className="space-y-4 p-5 md:p-6">
        {grounding && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Grading against</span>
            {grounding.source === "b3" ? <Badge variant="success">B3{grounding.version ? ` v${grounding.version}` : ""} compliance + creative DNA</Badge> : grounding.source === "flat" ? <Badge variant="warning">brand profile (no approved B3)</Badge> : <Badge variant="outline">no brand data</Badge>}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Gate an external image <span className="text-muted-foreground">(paste a URL)</span></Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Link2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://…/creative.jpg" className="pl-9" />
            </div>
            <Button onClick={() => gate({ sourceSystem: "external", assetPath: externalUrl.trim() }, "ext")} disabled={!/^https?:\/\//.test(externalUrl.trim()) || busyId === "ext"}>
              {busyId === "ext" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Gate
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>…or pick a produced static creative</Label>
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">No completed static creatives yet — produce some in Static Generation, then gate them here.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
              {items.map((it) => (
                <button key={it.id} type="button" onClick={() => gate({ sourceSystem: "static", sourceId: it.id }, it.id)} disabled={!!busyId}
                  className={cn("group relative aspect-square overflow-hidden rounded-xl border border-border/60 bg-muted text-left transition-colors hover:border-accent/60", busyId === it.id && "ring-2 ring-accent")}>
                  {it.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.thumbUrl} alt={it.label} className="size-full object-cover" />
                  ) : <span className="flex size-full items-center justify-center p-2 text-[10px] text-muted-foreground">{it.label}</span>}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/40 group-hover:opacity-100">
                    {busyId === it.id ? <Loader2 className="size-5 animate-spin text-white" /> : <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-foreground">Gate</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </BentoCard>
    </div>
  );
}
