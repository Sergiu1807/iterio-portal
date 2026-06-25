"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, Check, ImagePlus, Wand2 } from "lucide-react";
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
  // pre-fill handed over from a Competitor Research "Remake" (the competitor image
  // shows as a transient selected reference; the adapted copy goes in the Copy field).
  const [remakeRef, setRemakeRef] = useState<ReferenceItem | null>(null);
  const [remakeNote, setRemakeNote] = useState<string[] | null>(null);

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

  // Apply a Remake hand-off (sessionStorage), if present and for this brand.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("iterio:remake-prefill");
      if (!raw) return;
      const p = JSON.parse(raw) as {
        target?: string; mode?: string; brandId?: string; referencePath?: string; referenceUrl?: string | null; adCopy?: string; briefText?: string;
        productId?: string | null; aspectRatios?: string[]; variationCount?: number; resolution?: string;
        compliance?: { pass?: boolean; failures?: string[] };
      };
      // Brief → production handoff (Brief Generator sends an assembled brief into Brief mode).
      if (p.target === "static" && p.mode === "brief" && p.brandId === brandId && p.briefText) {
        sessionStorage.removeItem("iterio:remake-prefill");
        setMode("brief");
        setBrief(p.briefText);
        setProductId(p.productId ?? null);
        if (p.compliance?.pass === false && p.compliance.failures?.length) setRemakeNote(p.compliance.failures);
        toast.success("Pre-filled from a brief", { description: "Review the brief, then Generate." });
        return;
      }
      if (p.target !== "static" || p.brandId !== brandId || !p.referencePath) return;
      sessionStorage.removeItem("iterio:remake-prefill");
      setMode("reference");
      setRemakeRef({ id: "__remake__", name: "Competitor reference", imagePath: p.referencePath, url: p.referenceUrl ?? null, createdAt: new Date().toISOString() });
      setRefPath(p.referencePath);
      setAdCopy(p.adCopy ?? "");
      setProductId(p.productId ?? null);
      if (p.aspectRatios?.length) setRatios(p.aspectRatios);
      if (p.variationCount) setVariations(p.variationCount);
      if (p.resolution) setResolution(p.resolution);
      if (p.compliance?.pass === false && p.compliance.failures?.length) setRemakeNote(p.compliance.failures);
      toast.success("Pre-filled from a competitor remake", { description: "Review the reference + copy, then Generate." });
    } catch {
      /* ignore */
    }
  }, [brandId]);

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
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,380px)_1fr] lg:items-start">
      {/* ── control rail ── */}
      <BentoCard className="space-y-5 p-5 lg:sticky lg:top-6">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Wand2 className="size-4" />
          </span>
          <h3 className="font-display text-base font-medium">Compose</h3>
        </div>
        {remakeNote && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            <p className="font-medium">Compliance flags to review before generating:</p>
            <ul className="mt-1 list-disc pl-4">{remakeNote.map((f, i) => <li key={i}>{f}</li>)}</ul>
          </div>
        )}
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
                {(remakeRef ? [remakeRef, ...references] : references).map((ref) => (
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
              <FormatChip key={r} ratio={r} active={ratios.includes(r)} onClick={() => toggleRatio(r)} />
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

        <Button onClick={generate} disabled={running || !canGenerate} size="lg" className={cn("w-full", canGenerate && !running && "cta-glow")}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Generate{" "}
          {ratios.length * variations > 1 ? `(${ratios.length * variations})` : ""}
        </Button>
      </BentoCard>

      {/* ── results canvas ── */}
      <div className="results-canvas min-h-[62vh] p-4 md:p-5">
        {batchTiles.length === 0 ? (
          <div className="flex h-full min-h-[52vh] flex-col items-center justify-center gap-3 text-center animate-fade-in">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent/12 text-accent">
              <Wand2 className="size-6" />
            </span>
            <p className="max-w-xs text-sm text-muted-foreground">
              {mode === "reference"
                ? "Pick a product, choose a reference, and hit Generate. Your results stream in here."
                : "Pick a product (optional), write a brief, and hit Generate. Your results stream in here."}
            </p>
          </div>
        ) : (
          <div className="stagger grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
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

function FormatChip({ ratio, active, onClick }: { ratio: string; active: boolean; onClick: () => void }) {
  const [w, h] = ratio.split(":").map(Number);
  const H = 16;
  const W = Math.max(7, Math.round((w / h) * H));
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-colors",
        active ? "border-primary/50 bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground"
      )}
    >
      <span className="flex h-4 w-7 items-center justify-center">
        <span className="rounded-[3px] border-2" style={{ width: W, height: H, borderColor: "currentColor" }} />
      </span>
      {ratio}
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
