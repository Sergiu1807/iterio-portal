"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Clapperboard, Check, Image as ImageIcon } from "lucide-react";
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
  const [remakeNote, setRemakeNote] = useState<string[] | null>(null);

  useEffect(() => {
    fetch(`/api/brands/${brandId}/product-media`).then((r) => (r.ok ? r.json() : { media: {} })).then((d) => setProductMedia(d.media ?? {})).catch(() => {});
    fetch(`/api/systems/video-generation/characters?brandId=${brandId}`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setCharacters(d.items ?? [])).catch(() => {});
    fetch(`/api/systems/video-generation/scenes?brandId=${brandId}`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setScenes(d.items ?? [])).catch(() => {});
  }, [brandId]);

  // Apply a Remake hand-off (sessionStorage) → fill the Script/direction field.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("iterio:remake-prefill");
      if (!raw) return;
      const p = JSON.parse(raw) as {
        target?: string; brandId?: string; script?: string; productId?: string | null;
        duration?: number; aspectRatio?: string; resolution?: string; variationCount?: number;
        compliance?: { pass?: boolean; failures?: string[] };
      };
      if (p.target !== "video" || p.brandId !== brandId || !p.script) return;
      sessionStorage.removeItem("iterio:remake-prefill");
      setVideoType("ugc");
      setScript(p.script);
      setProductId(p.productId ?? null);
      if (p.duration) setDuration(p.duration);
      if (p.aspectRatio) setAspect(p.aspectRatio);
      if (p.resolution) setResolution(p.resolution);
      if (p.variationCount) setVariations(p.variationCount);
      if (p.compliance?.pass === false && p.compliance.failures?.length) setRemakeNote(p.compliance.failures);
      toast.success("Pre-filled from a competitor remake", { description: "Review the script + product, then Generate." });
    } catch {
      /* ignore */
    }
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

        {remakeNote && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            <p className="font-medium">Compliance flags to review before generating:</p>
            <ul className="mt-1 list-disc pl-4">{remakeNote.map((f, i) => <li key={i}>{f}</li>)}</ul>
          </div>
        )}

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
            <div className="flex flex-wrap gap-2.5">
              <SpecialTile active={productId === null} onClick={() => setProductId(null)} label="No product" ratio="aspect-[4/5]" />
              {products.map((p) => (
                <MediaTile
                  key={p.id}
                  src={productMedia[p.id]?.video || productMedia[p.id]?.image || null}
                  name={p.name}
                  ratio="aspect-[4/5]"
                  selected={productId === p.id}
                  onClick={() => setProductId(p.id)}
                  badge={p.isHero ? "Hero" : undefined}
                />
              ))}
            </div>
          </Field>
        )}

        {showCharacters && (
          <Field label="Characters" hint={characters.length ? "Select talent refs" : "Add some in the Characters tab"}>
            {characters.length === 0 ? (
              <p className="text-xs text-muted-foreground">None yet — the agent will describe talent from your script.</p>
            ) : (
              <div className="flex flex-wrap gap-2.5">
                {characters.map((c) => (
                  <MediaTile key={c.id} src={c.url} name={c.name} ratio="aspect-square" selected={characterIds.includes(c.id)} onClick={() => toggleCharacter(c.id)} />
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
              <div className="flex flex-wrap gap-2.5">
                <SpecialTile active={sceneId === null} onClick={() => setSceneId(null)} label="Auto" ratio="aspect-square" />
                {scenes.map((s) => (
                  <MediaTile key={s.id} src={s.url} name={s.name} ratio="aspect-square" selected={sceneId === s.id} onClick={() => setSceneId(s.id)} />
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

/** Image-forward selectable tile for products / characters / scenes. */
function MediaTile({
  src,
  name,
  ratio,
  selected,
  onClick,
  badge,
}: {
  src: string | null;
  name: string;
  ratio: string;
  selected: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={name}
      className={cn(
        "relative w-[88px] overflow-hidden rounded-xl border text-left transition-all",
        selected ? "border-primary ring-2 ring-primary/30" : "border-border/70 hover:-translate-y-0.5 hover:border-border"
      )}
    >
      <div className={cn("w-full overflow-hidden bg-muted", ratio)}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/40">
            <ImageIcon className="size-5" />
          </div>
        )}
      </div>
      {badge && (
        <span className="absolute left-1 top-1">
          <Badge variant="accent">{badge}</Badge>
        </span>
      )}
      {selected && (
        <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary text-white">
          <Check className="size-3" />
        </span>
      )}
      <span className="block truncate px-2 py-1.5 text-[11px] font-medium">{name}</span>
    </button>
  );
}

/** Same-sized "No product" / "Auto" option tile. */
function SpecialTile({ active, onClick, label, ratio }: { active: boolean; onClick: () => void; label: string; ratio: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-[88px] flex-col items-center justify-center rounded-xl border border-dashed text-center text-xs font-medium transition-colors",
        ratio,
        active ? "border-primary/60 bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}
