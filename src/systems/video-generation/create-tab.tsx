"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Clapperboard, Check } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea, Label } from "@/components/ui/input";
import { useBrand } from "@/lib/brand-store";
import { cn } from "@/lib/utils";
import { VIDEO_TYPES, AROLL_STYLES, DURATIONS, DEFAULT_DURATION, VIDEO_ASPECT_RATIOS, DEFAULT_ASPECT, RESOLUTIONS, DEFAULT_RESOLUTION, MAX_VARIATIONS } from "./constants";
import type { VideoGen, VideoRef } from "./ui-types";
import { VideoTile } from "./result-tile";

type ProductMedia = Record<string, { image: string | null; video: string | null }>;

export function CreateTab({ brandId, generations, reload }: { brandId: string; generations: VideoGen[]; reload: () => void }) {
  const { currentBrand } = useBrand();
  const products = currentBrand?.products ?? [];

  const [productMedia, setProductMedia] = useState<ProductMedia>({});
  const [characters, setCharacters] = useState<VideoRef[]>([]);
  const [scenes, setScenes] = useState<VideoRef[]>([]);

  const [videoType, setVideoType] = useState<"ugc" | "broll" | "aroll">("ugc");
  const [arollStyle, setArollStyle] = useState<string>("street-interview");
  const [productId, setProductId] = useState<string | null>(null);
  const [characterIds, setCharacterIds] = useState<string[]>([]);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [aspect, setAspect] = useState<string>(DEFAULT_ASPECT);
  const [resolution, setResolution] = useState<string>(DEFAULT_RESOLUTION);
  const [variations, setVariations] = useState(1);
  const [running, setRunning] = useState(false);
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/brands/${brandId}/product-media`).then((r) => (r.ok ? r.json() : { media: {} })).then((d) => setProductMedia(d.media ?? {})).catch(() => {});
    fetch(`/api/systems/video-generation/characters?brandId=${brandId}`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setCharacters(d.items ?? [])).catch(() => {});
    fetch(`/api/systems/video-generation/scenes?brandId=${brandId}`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setScenes(d.items ?? [])).catch(() => {});
  }, [brandId]);

  const isAroll = videoType === "aroll";
  const noProductStyle = isAroll && (arollStyle === "talking-head" || arollStyle === "podcast");
  const showProduct = !noProductStyle && videoType !== "aroll" ? true : isAroll && (arollStyle === "street-interview" || arollStyle === "green-screen");
  const showCharacters = videoType === "ugc" || isAroll;
  const showScene = isAroll && arollStyle === "podcast";

  const toggleCharacter = (id: string) => setCharacterIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const generate = async () => {
    setRunning(true);
    const res = await fetch(`/api/systems/video-generation/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brandId,
        videoType,
        arollStyle: isAroll ? arollStyle : null,
        productId: showProduct ? productId : null,
        characterIds: showCharacters ? characterIds : [],
        sceneId: showScene ? sceneId : null,
        script: script.trim() || null,
        duration,
        aspectRatio: aspect,
        resolution,
        variationCount: variations,
      }),
    });
    setRunning(false);
    if (res.ok) {
      setLastBatchId(((await res.json()) as { batchId: string }).batchId);
      toast.success("Generating — the pipeline writes the prompt, then renders. This takes a few minutes.");
      reload();
    } else {
      toast.error(((await res.json().catch(() => ({}))) as { error?: string })?.error ?? "Couldn't start generation");
    }
  };

  const batchTiles = useMemo(
    () => (lastBatchId ? generations.filter((g) => g.batchId === lastBatchId).sort((a, b) => a.batchIndex - b.batchIndex) : []),
    [generations, lastBatchId]
  );

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,400px)_1fr] lg:items-start">
      {/* control rail */}
      <BentoCard className="space-y-5 p-5 lg:sticky lg:top-6">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Clapperboard className="size-4" />
          </span>
          <h3 className="font-display text-base font-medium">Compose</h3>
        </div>

        <Field label="Video type">
          <div className="flex flex-wrap gap-2">
            {VIDEO_TYPES.map((t) => (
              <ChipButton key={t.value} active={videoType === t.value} onClick={() => setVideoType(t.value)}>
                {t.label}
              </ChipButton>
            ))}
          </div>
        </Field>

        {isAroll && (
          <Field label="A-Roll style">
            <div className="flex flex-wrap gap-2">
              {AROLL_STYLES.map((s) => (
                <ChipButton key={s.value} active={arollStyle === s.value} onClick={() => setArollStyle(s.value)}>
                  {s.label}
                </ChipButton>
              ))}
            </div>
          </Field>
        )}

        {showProduct && (
          <Field label="Product" hint="Uses the 9:16 image">
            <div className="flex flex-wrap gap-2">
              <ChipButton active={productId === null} onClick={() => setProductId(null)}>
                No product
              </ChipButton>
              {products.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProductId(p.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-2 py-1.5 text-xs transition-colors",
                    productId === p.id ? "border-primary/50 bg-primary/8 text-foreground" : "border-border/70 hover:border-border"
                  )}
                >
                  <span className="size-7 shrink-0 overflow-hidden rounded-md bg-muted">
                    {productMedia[p.id]?.video || productMedia[p.id]?.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={(productMedia[p.id].video || productMedia[p.id].image)!} alt="" className="size-full object-cover" />
                    ) : null}
                  </span>
                  <span className="max-w-[120px] truncate">{p.name}</span>
                  {p.isHero && <Badge variant="accent">Hero</Badge>}
                </button>
              ))}
            </div>
          </Field>
        )}

        {showCharacters && (
          <Field label="Characters" hint={characters.length ? "Select talent refs" : "Add some in the Characters tab"}>
            {characters.length === 0 ? (
              <p className="text-xs text-muted-foreground">None yet — the agent will describe talent from your script.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {characters.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => toggleCharacter(c.id)}
                    className={cn(
                      "relative size-14 overflow-hidden rounded-xl border bg-muted",
                      characterIds.includes(c.id) ? "border-primary ring-2 ring-primary/30" : "border-border/70 hover:border-border"
                    )}
                    title={c.name}
                  >
                    {c.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.url} alt={c.name} className="size-full object-cover" />
                    ) : null}
                    {characterIds.includes(c.id) && (
                      <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary text-white">
                        <Check className="size-3" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </Field>
        )}

        {showScene && (
          <Field label="Scene" hint={scenes.length ? "Podcast backdrop" : "Add some in the Scenes tab"}>
            {scenes.length === 0 ? (
              <p className="text-xs text-muted-foreground">None yet — a studio scene will be invented.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <ChipButton active={sceneId === null} onClick={() => setSceneId(null)}>
                  Auto
                </ChipButton>
                {scenes.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSceneId(s.id)}
                    className={cn(
                      "relative size-14 overflow-hidden rounded-xl border bg-muted",
                      sceneId === s.id ? "border-primary ring-2 ring-primary/30" : "border-border/70 hover:border-border"
                    )}
                    title={s.name}
                  >
                    {s.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.url} alt={s.name} className="size-full object-cover" />
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </Field>
        )}

        <Field label="Script / direction" hint="Optional — the agent fills gaps">
          <Textarea value={script} onChange={(e) => setScript(e.target.value)} placeholder="What's said and shown — dialogue, hook, beats…" className="min-h-[120px]" />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Duration">
            <div className="flex gap-1.5">
              {DURATIONS.map((d) => (
                <ChipButton key={d} active={duration === d} onClick={() => setDuration(d)}>
                  {d}s
                </ChipButton>
              ))}
            </div>
          </Field>
          <Field label="Variations">
            <div className="flex gap-1.5">
              {Array.from({ length: MAX_VARIATIONS }, (_, i) => i + 1).map((n) => (
                <ChipButton key={n} active={variations === n} onClick={() => setVariations(n)}>
                  {n}
                </ChipButton>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Aspect ratio">
          <div className="flex flex-wrap gap-1.5">
            {VIDEO_ASPECT_RATIOS.map((r) => (
              <ChipButton key={r} active={aspect === r} onClick={() => setAspect(r)}>
                {r}
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

        <Button onClick={generate} disabled={running} size="lg" className={cn("w-full", !running && "cta-glow")}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" />} Generate {variations > 1 ? `(${variations})` : ""}
        </Button>
      </BentoCard>

      {/* results canvas */}
      <div className="results-canvas min-h-[62vh] p-4 md:p-5">
        {batchTiles.length === 0 ? (
          <div className="flex h-full min-h-[52vh] flex-col items-center justify-center gap-3 text-center animate-fade-in">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent/12 text-accent">
              <Clapperboard className="size-6" />
            </span>
            <p className="max-w-xs text-sm text-muted-foreground">Pick a video type, add a product or script, and hit Generate. Your videos render here.</p>
          </div>
        ) : (
          <div className="stagger grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {batchTiles.map((g) => (
              <VideoTile key={g.id} gen={g} onReload={reload} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label>{label}</Label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-primary/50 bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
