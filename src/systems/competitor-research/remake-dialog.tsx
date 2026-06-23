"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Wand2, ImageIcon, Clapperboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Concept } from "./ui-types";

type ProductLite = { id: string; name: string; image: string | null };

const STATIC_RATIOS = ["1:1", "4:5", "9:16", "16:9"];
const VIDEO_DURATIONS = [5, 10, 15];

export function RemakeDialog({
  concept,
  brandId,
  products,
  onClose,
}: {
  concept: Concept | null;
  brandId: string;
  products: ProductLite[];
  onClose: () => void;
}) {
  const [target, setTarget] = useState<"static" | "video">("static");
  const [productId, setProductId] = useState<string | null>(null);
  const [ratios, setRatios] = useState<Set<string>>(new Set(["1:1", "4:5"]));
  const [variations, setVariations] = useState(2);
  const [duration, setDuration] = useState(10);
  const [submitting, setSubmitting] = useState(false);

  if (!concept) return null;

  const maxVars = target === "video" ? 3 : 4;
  const vars = Math.min(variations, maxVars);

  const toggleRatio = (r: string) =>
    setRatios((prev) => {
      const next = new Set(prev);
      next.has(r) ? next.delete(r) : next.add(r);
      return next.size ? next : new Set(["1:1"]);
    });

  const submit = async () => {
    setSubmitting(true);
    const body =
      target === "video"
        ? { brandId, conceptId: concept.id, target, productId, duration, variationCount: vars }
        : { brandId, conceptId: concept.id, target, productId, aspectRatios: [...ratios], variationCount: vars };
    const res = await fetch("/api/systems/competitor-research/remake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (res.ok) {
      toast.success(`Seeded ${data.ids?.length ?? ""} ${target} variant${data.ids?.length === 1 ? "" : "s"}`, {
        description: `On-brand remake started — see the ${target === "video" ? "Video" : "Static"} system's gallery.`,
      });
      onClose();
    } else if (res.status === 422 && Array.isArray(data.failures)) {
      toast.error("Blocked by the compliance gate", { description: data.failures.slice(0, 4).join(" · ") });
    } else {
      toast.error(data?.error ?? "Remake failed");
    }
  };

  return (
    <Dialog open={!!concept} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <div className="space-y-5">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 font-display text-lg font-medium tracking-tight">
              <Wand2 className="size-4 text-primary" /> Remake winner
            </h2>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {concept.title}
              {concept.advertiser ? <span className="text-muted-foreground/70"> · {concept.advertiser}</span> : null}
            </p>
          </div>

          {/* target */}
          <div className="grid grid-cols-2 gap-2">
            {(["static", "video"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTarget(t)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
                  target === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {t === "static" ? <ImageIcon className="size-4" /> : <Clapperboard className="size-4" />}
                {t === "static" ? "Static ad" : "Video"}
              </button>
            ))}
          </div>

          {/* product */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Feature product (optional)</label>
            <select
              value={productId ?? ""}
              onChange={(e) => setProductId(e.target.value || null)}
              className="h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm"
            >
              <option value="">No specific product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* target-specific options */}
          {target === "static" ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Aspect ratios</label>
              <div className="flex flex-wrap gap-1.5">
                {STATIC_RATIOS.map((r) => (
                  <button
                    key={r}
                    onClick={() => toggleRatio(r)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      ratios.has(r) ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Duration</label>
              <div className="flex gap-1.5">
                {VIDEO_DURATIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      duration === d ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* variations */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Variations</label>
            <div className="flex gap-1.5">
              {Array.from({ length: maxVars }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => setVariations(n)}
                  className={cn(
                    "size-9 rounded-lg border text-sm font-medium transition-colors",
                    vars === n ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-4">
            <p className="text-xs text-muted-foreground">
              Extract → re-express. The {target} is rebuilt on your brand{target === "static" ? " (competitor image as reference + adapted copy)" : " (same concept, your script)"}, then compliance-checked.
            </p>
            <Button className="cta-glow shrink-0" onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} Remake
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
