"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PLACEMENTS, DEFAULT_VARIANTS, MAX_VARIANTS } from "./constants";

type AngleLite = { id: string; title: string; status: string; complianceFlag: string; funnelStage: string | null };
type BriefLite = { id: string; format: string; status: string; funnelStage: string | null };
type Grounding = { source: "b3" | "flat" | "none"; version: number | null };
const selectCls = "h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm";
const ELIGIBLE_ANGLE = ["approved", "shortlisted", "sent_to_brief"];

export function CreateTab({ brandId, onGenerated }: { brandId: string; onGenerated: () => void }) {
  const [src, setSrc] = useState<"angle" | "brief">("angle");
  const [angles, setAngles] = useState<AngleLite[]>([]);
  const [briefs, setBriefs] = useState<BriefLite[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [placement, setPlacement] = useState<string>("feed");
  const [variants, setVariants] = useState(DEFAULT_VARIANTS);
  const [running, setRunning] = useState(false);
  const [grounding, setGrounding] = useState<Grounding | null>(null);

  useEffect(() => {
    fetch(`/api/systems/ideation/angles?brandId=${brandId}`).then((r) => (r.ok ? r.json() : { angles: [] })).then((d: { angles: AngleLite[] }) => setAngles((d.angles ?? []).filter((a) => ELIGIBLE_ANGLE.includes(a.status) && a.complianceFlag !== "banned"))).catch(() => {});
    fetch(`/api/systems/brief-generation/briefs?brandId=${brandId}`).then((r) => (r.ok ? r.json() : { briefs: [] })).then((d: { briefs: BriefLite[] }) => setBriefs((d.briefs ?? []).filter((b) => b.status === "complete" || b.status === "approved"))).catch(() => {});
    fetch(`/api/systems/ad-copy/grounding?brandId=${brandId}`).then((r) => (r.ok ? r.json() : null)).then((d) => setGrounding(d)).catch(() => {});
  }, [brandId]);

  useEffect(() => { setSourceId(""); }, [src]);

  const generate = async () => {
    if (!sourceId) return toast.error(`Pick ${src === "angle" ? "an angle" : "a brief"}`);
    setRunning(true);
    const fn = src === "angle" ? { angleId: sourceId } : { briefId: sourceId };
    const res = await fetch(`/api/systems/ad-copy/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId, ...fn, placement, variantCount: variants }) });
    setRunning(false);
    if (res.ok) { toast.success("Generating copy — variants will stream into the Library."); onGenerated(); }
    else toast.error(((await res.json().catch(() => ({}))) as { error?: string })?.error ?? "Couldn't start copy");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BentoCard className="space-y-4 p-5 md:p-6">
        {grounding && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Grounding on</span>
            {grounding.source === "b3" ? <Badge variant="success">Brand Intelligence (B3{grounding.version ? ` v${grounding.version}` : ""})</Badge> : grounding.source === "flat" ? <Badge variant="warning">brand profile</Badge> : <Badge variant="outline">no brand data</Badge>}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Write copy from</Label>
          <div className="flex gap-2">
            {(["angle", "brief"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSrc(s)} className={cn("flex-1 rounded-xl border px-3 py-2 text-sm capitalize transition-colors", src === s ? "border-accent bg-accent/12 text-accent" : "border-input text-muted-foreground hover:bg-muted")}>{s === "angle" ? "An approved angle" : "A completed brief"}</button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{src === "angle" ? "Angle" : "Brief"}</Label>
          {src === "angle" ? (
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={selectCls}>
              <option value="">— Pick an angle —</option>
              {angles.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          ) : (
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={selectCls}>
              <option value="">— Pick a brief —</option>
              {briefs.map((b) => <option key={b.id} value={b.id}>{b.format} brief · {b.funnelStage ?? "TOF"} · {b.status}</option>)}
            </select>
          )}
          {((src === "angle" && angles.length === 0) || (src === "brief" && briefs.length === 0)) && <p className="text-xs text-muted-foreground">Nothing eligible yet — {src === "angle" ? "approve an angle in Ideation" : "complete a brief"} first.</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Placement</Label>
            <select value={placement} onChange={(e) => setPlacement(e.target.value)} className={selectCls}>{PLACEMENTS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}</select>
          </div>
          <div className="space-y-1.5">
            <Label>Variants</Label>
            <Input type="number" min={1} max={MAX_VARIANTS} value={variants} onChange={(e) => setVariants(Math.min(MAX_VARIANTS, Math.max(1, Number(e.target.value) || DEFAULT_VARIANTS)))} />
          </div>
        </div>

        <Button className="cta-glow w-full" onClick={generate} disabled={running || !sourceId}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Generate {variants} variants
        </Button>
      </BentoCard>
    </div>
  );
}
