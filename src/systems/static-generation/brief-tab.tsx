"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { ASPECT_RATIOS, RESOLUTIONS, DEFAULT_RESOLUTION, MAX_VARIATIONS } from "./constants";
import type { Generation } from "./ui-types";
import { GenTile } from "./result-tile";
import { Field, ChipButton } from "./create-tab";

export function BriefTab({
  brandId,
  hasLogo,
  generations,
  reload,
  renderActions,
}: {
  brandId: string;
  hasLogo: boolean;
  generations: Generation[];
  reload: () => void;
  renderActions?: (gen: Generation) => React.ReactNode;
}) {
  const [brief, setBrief] = useState("");
  const [ratios, setRatios] = useState<string[]>(["1:1"]);
  const [variations, setVariations] = useState(2);
  const [resolution, setResolution] = useState<string>(DEFAULT_RESOLUTION);
  const [running, setRunning] = useState(false);
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);

  const toggleRatio = (r: string) => setRatios((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const generate = async () => {
    if (!brief.trim()) return toast.error("Write a brief first");
    if (!ratios.length) return toast.error("Pick at least one format");
    setRunning(true);
    const res = await fetch(`/api/systems/static-generation/generate/brief`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, briefText: brief, aspectRatios: ratios, variationCount: variations, resolution }),
    });
    setRunning(false);
    if (res.ok) {
      setLastBatchId(((await res.json()) as { batchId: string }).batchId);
      toast.success("Generating from your brief…");
      reload();
    } else {
      toast.error(((await res.json().catch(() => ({}))) as { error?: string })?.error ?? "Couldn't start generation");
    }
  };

  const tiles = useMemo(
    () => (lastBatchId ? generations.filter((g) => g.batchId === lastBatchId).sort((a, b) => a.batchIndex - b.batchIndex) : []),
    [generations, lastBatchId]
  );

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,360px)_1fr]">
      <BentoCard className="space-y-5 p-5">
        <Field label="Creative brief" hint="Describe the ad — concept, message, offer">
          <Textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="A clean, editorial launch ad for our hero product. Lead with the core benefit, one bold headline, a soft product hero shot, and a Shop now CTA…"
            className="min-h-[200px]"
          />
        </Field>

        {!hasLogo && <p className="text-[11px] text-muted-foreground">Tip: upload a brand logo in Settings — Brief ads render it onto the canvas.</p>}

        <Field label="Formats">
          <div className="flex flex-wrap gap-2">
            {ASPECT_RATIOS.map((r) => (
              <ChipButton key={r} active={ratios.includes(r)} onClick={() => toggleRatio(r)}>
                {r}
              </ChipButton>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Variations">
            <div className="flex gap-1.5">
              {Array.from({ length: MAX_VARIATIONS }, (_, i) => i + 1).map((n) => (
                <ChipButton key={n} active={variations === n} onClick={() => setVariations(n)}>
                  {n}
                </ChipButton>
              ))}
            </div>
          </Field>
          <Field label="Resolution">
            <div className="flex gap-1.5">
              {RESOLUTIONS.map((r) => (
                <ChipButton key={r} active={resolution === r} onClick={() => setResolution(r)}>
                  {r}
                </ChipButton>
              ))}
            </div>
          </Field>
        </div>

        <Button onClick={generate} disabled={running || !brief.trim()} className="w-full">
          {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Generate{" "}
          {ratios.length * variations > 1 ? `(${ratios.length * variations})` : ""}
        </Button>
      </BentoCard>

      <div>
        {tiles.length === 0 ? (
          <div className="flex h-full min-h-[280px] items-center justify-center rounded-[var(--radius)] border border-dashed border-border text-center text-sm text-muted-foreground">
            <p className="max-w-xs">Write a brief and hit Generate. No reference image needed — the brand agents compose from your words.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {tiles.map((g) => (
              <GenTile key={g.id} gen={g} onReload={reload} actions={renderActions} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
