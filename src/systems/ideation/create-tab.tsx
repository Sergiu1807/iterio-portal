"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FUNNEL_STAGES, FORMATS, DEFAULT_COUNT, MAX_COUNT } from "./constants";

type Product = { id: string; name: string; isHero?: boolean };
type Grounding = { source: "b3" | "flat" | "none"; version: number | null; hasCompliance: boolean; personaCount: number };

const selectCls = "h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm";

export function CreateTab({ brandId, products, onGenerated }: { brandId: string; products: Product[]; onGenerated: () => void }) {
  const [objective, setObjective] = useState("");
  const [funnelStage, setFunnelStage] = useState<string>("TOF");
  const [formats, setFormats] = useState<string[]>(["any"]);
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [productId, setProductId] = useState("");
  const [theme, setTheme] = useState("");
  const [running, setRunning] = useState(false);
  const [grounding, setGrounding] = useState<Grounding | null>(null);

  useEffect(() => {
    fetch(`/api/systems/ideation/grounding?brandId=${brandId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setGrounding(d))
      .catch(() => {});
  }, [brandId]);

  const toggleFormat = (f: string) => {
    setFormats((prev) => {
      if (f === "any") return ["any"];
      const next = prev.filter((x) => x !== "any");
      return next.includes(f) ? next.filter((x) => x !== f) : [...next, f];
    });
  };

  const generate = async () => {
    setRunning(true);
    const res = await fetch(`/api/systems/ideation/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, objective: objective.trim() || undefined, funnelStage, formats: formats.length ? formats : ["any"], count, productId: productId || null, theme: theme.trim() || undefined }),
    });
    setRunning(false);
    if (res.ok) {
      toast.success("Generating angles — they'll stream into the Library.");
      onGenerated();
    } else {
      toast.error(((await res.json().catch(() => ({}))) as { error?: string })?.error ?? "Couldn't start generation");
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BentoCard className="space-y-4 p-5 md:p-6">
        {/* grounding banner */}
        {grounding && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Grounding on</span>
            {grounding.source === "b3" ? (
              <Badge variant="success">Brand Intelligence (B3{grounding.version ? ` v${grounding.version}` : ""})</Badge>
            ) : grounding.source === "flat" ? (
              <Badge variant="warning">brand profile (no approved B3 yet)</Badge>
            ) : (
              <Badge variant="outline">no brand data — generate cautiously</Badge>
            )}
            {grounding.personaCount > 0 && <span className="text-muted-foreground">· {grounding.personaCount} personas</span>}
            {grounding.hasCompliance && <span className="text-muted-foreground">· compliance ruleset active</span>}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Campaign objective <span className="text-muted-foreground">(optional)</span></Label>
          <Textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} placeholder="e.g. drive first purchase of Hormone Harmony among perimenopausal women frustrated by sleep + mood" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Funnel stage</Label>
            <select value={funnelStage} onChange={(e) => setFunnelStage(e.target.value)} className={selectCls}>
              {FUNNEL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Focus product <span className="text-muted-foreground">(optional)</span></Label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className={selectCls}>
              <option value="">— Whole brand —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isHero ? " ★" : ""}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Format(s)</Label>
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => toggleFormat(f)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm capitalize transition-colors",
                  formats.includes(f) ? "border-accent bg-accent/12 text-accent" : "border-input text-muted-foreground hover:bg-muted"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>How many angles</Label>
            <Input type="number" min={1} max={MAX_COUNT} value={count} onChange={(e) => setCount(Math.min(MAX_COUNT, Math.max(1, Number(e.target.value) || DEFAULT_COUNT)))} />
          </div>
          <div className="space-y-1.5">
            <Label>Theme / seed <span className="text-muted-foreground">(optional)</span></Label>
            <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="e.g. winter, gifting, founder story" />
          </div>
        </div>

        <Button className="cta-glow w-full" onClick={generate} disabled={running}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Generate {count} angles
        </Button>
      </BentoCard>
    </div>
  );
}
