"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2, Check } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BRIEF_FORMATS, DEPTHS } from "./constants";
import { BRIEF_PREFILL_KEY, type BriefPrefill } from "./bridge";
import type { BriefReference } from "./ui-types";

type AngleLite = { id: string; title: string; format: string | null; funnelStage: string | null; status: string; complianceFlag: string };
type Grounding = { source: "b3" | "flat" | "none"; version: number | null; hasCompliance: boolean; personaCount: number };

const selectCls = "h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm";
const ELIGIBLE = ["approved", "shortlisted", "sent_to_brief"];

export function CreateTab({ brandId, onGenerated }: { brandId: string; onGenerated: () => void }) {
  const [angles, setAngles] = useState<AngleLite[]>([]);
  const [angleId, setAngleId] = useState("");
  const [format, setFormat] = useState<string>("static");
  const [depth, setDepth] = useState<string>("standard");
  const [refs, setRefs] = useState<BriefReference[]>([]);
  const [refSel, setRefSel] = useState<BriefReference | null>(null);
  const [notes, setNotes] = useState("");
  const [running, setRunning] = useState(false);
  const [grounding, setGrounding] = useState<Grounding | null>(null);

  // load eligible angles + references + grounding
  useEffect(() => {
    fetch(`/api/systems/ideation/angles?brandId=${brandId}`)
      .then((r) => (r.ok ? r.json() : { angles: [] }))
      .then((d: { angles: AngleLite[] }) => {
        const eligible = (d.angles ?? []).filter((a) => ELIGIBLE.includes(a.status) && a.complianceFlag !== "banned");
        setAngles(eligible);
      })
      .catch(() => {});
    fetch(`/api/systems/brief-generation/references?brandId=${brandId}`)
      .then((r) => (r.ok ? r.json() : { references: [] }))
      .then((d: { references: BriefReference[] }) => setRefs(d.references ?? []))
      .catch(() => {});
    fetch(`/api/systems/brief-generation/grounding?brandId=${brandId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setGrounding(d))
      .catch(() => {});
  }, [brandId]);

  // send-to-brief handoff: preload the angle that was sent over.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BRIEF_PREFILL_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as BriefPrefill;
      if (p.target !== "brief" || p.brandId !== brandId || !p.angleId) return;
      sessionStorage.removeItem(BRIEF_PREFILL_KEY);
      setAngleId(p.angleId);
      if (p.format && p.format !== "any") setFormat(p.format);
      toast.success("Angle loaded — pick a format + reference, then generate the brief.");
    } catch { /* ignore */ }
  }, [brandId]);

  // when the chosen angle changes, default the format to the angle's
  useEffect(() => {
    const a = angles.find((x) => x.id === angleId);
    if (a?.format && a.format !== "any" && BRIEF_FORMATS.includes(a.format as (typeof BRIEF_FORMATS)[number])) setFormat(a.format);
  }, [angleId, angles]);

  const generate = async () => {
    if (!angleId) return toast.error("Pick an approved angle to brief");
    setRunning(true);
    const res = await fetch(`/api/systems/brief-generation/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, angleId, format, depth, notes: notes.trim() || undefined, referenceRef: refSel ? { kind: refSel.kind, id: refSel.id, storageKey: refSel.storageKey } : null }),
    });
    setRunning(false);
    if (res.ok) { toast.success("Generating the brief — it'll stream into the Library."); onGenerated(); }
    else toast.error(((await res.json().catch(() => ({}))) as { error?: string })?.error ?? "Couldn't start the brief");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BentoCard className="space-y-4 p-5 md:p-6">
        {grounding && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Grounding on</span>
            {grounding.source === "b3" ? <Badge variant="success">Brand Intelligence (B3{grounding.version ? ` v${grounding.version}` : ""})</Badge>
              : grounding.source === "flat" ? <Badge variant="warning">brand profile (no approved B3 yet)</Badge>
              : <Badge variant="outline">no brand data</Badge>}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Approved angle</Label>
          <select value={angleId} onChange={(e) => setAngleId(e.target.value)} className={selectCls}>
            <option value="">— Pick an angle —</option>
            {angles.map((a) => <option key={a.id} value={a.id}>{a.title}{a.format && a.format !== "any" ? ` · ${a.format}` : ""}{a.status === "sent_to_brief" ? " (re-brief)" : ""}</option>)}
          </select>
          {angles.length === 0 && <p className="text-xs text-muted-foreground">No eligible angles yet — approve one in Ideation first.</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Format</Label>
            <select value={format} onChange={(e) => setFormat(e.target.value)} className={selectCls}>
              {BRIEF_FORMATS.map((f) => <option key={f} value={f} className="capitalize">{f}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Depth</Label>
            <select value={depth} onChange={(e) => setDepth(e.target.value)} className={selectCls}>
              {DEPTHS.map((d) => <option key={d} value={d} className="capitalize">{d}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Reference to recreate <span className="text-muted-foreground">(optional)</span></Label>
          {refs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No competitor winners or past statics to draw from yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {refs.map((r) => (
                <button key={`${r.kind}:${r.id}`} type="button" onClick={() => setRefSel(refSel?.id === r.id ? null : r)}
                  className={cn("group relative aspect-square overflow-hidden rounded-lg border bg-muted text-left", refSel?.id === r.id ? "border-accent ring-2 ring-accent/40" : "border-border/60 hover:border-accent/50")}>
                  {r.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.thumbUrl} alt={r.label} className="size-full object-cover" />
                  ) : <span className="flex size-full items-center justify-center p-1 text-[9px] text-muted-foreground">{r.label}</span>}
                  {refSel?.id === r.id && <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-accent text-accent-foreground"><Check className="size-2.5" /></span>}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1 py-0.5 text-[8px] text-white">{r.kind === "competitor_ad" ? "competitor" : "static"}</span>
                </button>
              ))}
            </div>
          )}
          {refSel && <p className="text-xs text-muted-foreground">Recreating the structure of: <span className="font-medium text-foreground/80">{refSel.label}</span></p>}
        </div>

        <div className="space-y-1.5">
          <Label>Notes <span className="text-muted-foreground">(optional)</span></Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Any direction — must-include proof, a hook tweak, length, etc." />
        </div>

        <Button className="cta-glow w-full" onClick={generate} disabled={running || !angleId}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Generate brief
        </Button>
      </BentoCard>
    </div>
  );
}
