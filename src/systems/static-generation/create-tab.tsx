"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, Check, ImagePlus } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea, Label } from "@/components/ui/input";
import { useBrand } from "@/lib/brand-store";
import { cn } from "@/lib/utils";
import { ASPECT_RATIOS, RESOLUTIONS, DEFAULT_RESOLUTION, MAX_VARIATIONS } from "./constants";
import type { Generation, ReferenceItem } from "./ui-types";
import { GenTile } from "./result-tile";

type ProductMedia = Record<string, { image: string | null; video: string | null }>;
type Mode = "reference" | "brief";

export function CreateTab({
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
  const { currentBrand } = useBrand();
  const products = currentBrand?.products ?? [];

  const [productMedia, setProductMedia] = useState<ProductMedia>({});
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [mode, setMode] = useState<Mode>("reference");
  const [productId, setProductId] = useState<string | null>(null);
  const [refPath, setRefPath] = useState<string | null>(null);
  const [adCopy, setAdCopy] = useState("");
  const [brief, setBrief] = useState("");
  const [ratios, setRatios] = useState<string[]>(["1:1"]);
  const [variations, setVariations] = useState(2);
  const [resolution, setResolution] = useState<string>(DEFAULT_RESOLUTION);
  const [running, setRunning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadRefs = useCallback(async () => {
    const r = await fetch(`/api/systems/static-generation/references?brandId=${brandId}`);
    if (r.ok) setReferences(((await r.json()) as { references: ReferenceItem[] }).references);
  }, [brandId]);

  useEffect(() => {
    loadRefs();
    fetch(`/api/brands/${brandId}/product-media`)
      .then((r) => (r.ok ? r.json() : { media: {} }))
      .then((d) => setProductMedia(d.media ?? {}))
      .catch(() => {});
  }, [brandId, loadRefs]);

  const uploadRef = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.append("brandId", brandId);
    fd.append("file", file);
    const r = await fetch(`/api/systems/static-generation/references`, { method: "POST", body: fd });
    setUploading(false);
    if (r.ok) {
      const ref = (await r.json()) as ReferenceItem;
      setReferences((prev) => [ref, ...prev]);
      setRefPath(ref.imagePath);
      toast.success("Reference added");
    } else {
      toast.error(((await r.json().catch(() => ({}))) as { error?: string })?.error ?? "Upload failed");
    }
  };

  const toggleRatio = (r: string) => setRatios((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const generate = async () => {
    if (mode === "reference" && !refPath) return toast.error("Pick or upload a reference image");
    if (mode === "brief" && !brief.trim()) return toast.error("Write a creative brief");
    if (!ratios.length) return toast.error("Pick at least one format");
    setRunning(true);
    const url = mode === "reference" ? `/api/systems/static-generation/generate` : `/api/systems/static-generation/generate/brief`;
    const body =
      mode === "reference"
        ? { brandId, referencePath: refPath, productId, adCopy: adCopy.trim() || null, aspectRatios: ratios, variationCount: variations, resolution }
        : { brandId, briefText: brief, productId, aspectRatios: ratios, variationCount: variations, resolution };
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setRunning(false);
    if (res.ok) {
      setLastBatchId(((await res.json()) as { batchId: string }).batchId);
      toast.success(mode === "reference" ? "Generating — images stream in below." : "Generating from your brief…");
      reload();
    } else {
      toast.error(((await res.json().catch(() => ({}))) as { error?: string })?.error ?? "Couldn't start generation");
    }
  };

  const batchTiles = useMemo(
    () => (lastBatchId ? generations.filter((g) => g.batchId === lastBatchId).sort((a, b) => a.batchIndex - b.batchIndex) : []),
    [generations, lastBatchId]
  );

  const canGenerate = mode === "reference" ? !!refPath : !!brief.trim();

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,360px)_1fr]">
      {/* ── form ── */}
      <BentoCard className="space-y-5 p-5">
        {/* product */}
        <Field label="Product">
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
                  {productMedia[p.id]?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={productMedia[p.id].image!} alt="" className="size-full object-cover" />
                  ) : null}
                </span>
                <span className="max-w-[120px] truncate">{p.name}</span>
                {p.isHero && <Badge variant="accent">Hero</Badge>}
              </button>
            ))}
          </div>
        </Field>

        {/* source mode toggle */}
        <Field label="Source">
          <div className="flex w-full rounded-xl border border-border/70 p-1">
            <ToggleButton active={mode === "reference"} onClick={() => setMode("reference")}>
              Reference
            </ToggleButton>
            <ToggleButton active={mode === "brief"} onClick={() => setMode("brief")}>
              Brief
            </ToggleButton>
          </div>
        </Field>

        {mode === "reference" ? (
          <>
            {/* reference */}
            <Field label="Reference image" hint="Style/composition to follow — required">
              <div className="flex flex-wrap gap-2">
                {references.map((ref) => (
                  <button
                    key={ref.id}
                    onClick={() => setRefPath(ref.imagePath)}
                    className={cn(
                      "relative size-16 overflow-hidden rounded-xl border bg-muted",
                      refPath === ref.imagePath ? "border-primary ring-2 ring-primary/30" : "border-border/70 hover:border-border"
                    )}
                  >
                    {ref.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ref.url} alt={ref.name ?? ""} className="size-full object-cover" />
                    ) : null}
                    {refPath === ref.imagePath && (
                      <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary text-white">
                        <Check className="size-3" />
                      </span>
                    )}
                  </button>
                ))}
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex size-16 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-muted-foreground hover:border-border hover:text-foreground"
                >
                  {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                  <span className="text-[10px]">Upload</span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadRef(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </Field>

            {/* ad copy */}
            <Field label="Ad copy" hint="Optional — leave blank to let the agent write it">
              <Textarea value={adCopy} onChange={(e) => setAdCopy(e.target.value)} placeholder="Headline, offer, CTA…" className="min-h-[72px]" />
            </Field>
          </>
        ) : (
          <>
            {/* creative brief */}
            <Field label="Creative brief" hint="Describe the ad — concept, message, offer">
              <Textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="A clean, editorial launch ad for our hero product. Lead with the core benefit, one bold headline, a soft product hero shot, and a Shop now CTA…"
                className="min-h-[180px]"
              />
            </Field>
            {!hasLogo && <p className="-mt-2 text-[11px] text-muted-foreground">Tip: upload a brand logo in Settings — Brief ads render it onto the canvas.</p>}
          </>
        )}

        {/* formats */}
        <Field label="Formats">
          <div className="flex flex-wrap gap-2">
            {ASPECT_RATIOS.map((r) => (
              <ChipButton key={r} active={ratios.includes(r)} onClick={() => toggleRatio(r)}>
                {r}
              </ChipButton>
            ))}
          </div>
        </Field>

        {/* variations + resolution */}
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

        <Button onClick={generate} disabled={running || !canGenerate} className="w-full">
          {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Generate{" "}
          {ratios.length * variations > 1 ? `(${ratios.length * variations})` : ""}
        </Button>
      </BentoCard>

      {/* ── results ── */}
      <div>
        {batchTiles.length === 0 ? (
          <div className="flex h-full min-h-[280px] items-center justify-center rounded-[var(--radius)] border border-dashed border-border text-center text-sm text-muted-foreground">
            <p className="max-w-xs">
              {mode === "reference"
                ? "Pick a product, choose a reference, and hit Generate. Results appear here."
                : "Pick a product (optional), write a brief, and hit Generate. Results appear here."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {batchTiles.map((g) => (
              <GenTile key={g.id} gen={g} onReload={reload} actions={renderActions} />
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
      <div className="flex items-baseline justify-between">
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

function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-primary/12 text-primary" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
