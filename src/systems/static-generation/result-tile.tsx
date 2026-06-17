"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Maximize2, Download, Package, Stamp, BookmarkPlus, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Generation } from "./ui-types";
import { aspectClass, modeLabel, statusLabel } from "./ui-utils";

/** One generated-ad tile: image / status / error, with a lightbox and an
 *  optional action slot (refine / edit / save — added in later phases). */
export function GenTile({
  gen,
  onReload,
  actions,
}: {
  gen: Generation;
  onReload: () => void;
  actions?: (gen: Generation) => React.ReactNode;
}) {
  const [zoom, setZoom] = useState(false);
  const [reSigned, setReSigned] = useState(false);
  const done = gen.status === "completed" && !!gen.imageUrl;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]">
      <div className={cn("relative w-full overflow-hidden bg-muted", aspectClass(gen.aspectRatio))}>
        {done ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={gen.imageUrl!}
            alt=""
            loading="lazy"
            className="size-full animate-scale-in object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            onError={() => {
              if (!reSigned) {
                setReSigned(true);
                onReload(); // signed URL likely expired — refetch fresh ones
              }
            }}
          />
        ) : gen.status === "error" ? (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 p-4 text-center">
            <AlertTriangle className="size-6 text-destructive/70" />
            <p className="line-clamp-3 text-xs text-muted-foreground" title={gen.errorMessage ?? undefined}>
              {gen.errorMessage ?? "Generation failed"}
            </p>
          </div>
        ) : (
          <>
            <div className="shimmer absolute inset-0" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
              <span className="text-xs font-medium">{statusLabel(gen.status)}…</span>
            </div>
          </>
        )}

        {/* context badges */}
        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5">
          <span className="rounded-md bg-card/85 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur">{gen.aspectRatio}</span>
          {gen.mode !== "custom" && (
            <Badge variant="muted" className="bg-card/85 backdrop-blur">
              {modeLabel(gen.mode)}
            </Badge>
          )}
        </div>

        {/* hover scrim with actions */}
        {done && (
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <div className="flex justify-end p-2">
              <button
                onClick={() => setZoom(true)}
                aria-label="Expand"
                className="pointer-events-auto rounded-lg bg-card/80 p-1.5 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card"
              >
                <Maximize2 className="size-4" />
              </button>
            </div>
            <div className="pointer-events-auto flex items-center gap-0.5 bg-gradient-to-t from-foreground/80 via-foreground/25 to-transparent px-2 pb-2 pt-8">
              <a
                href={gen.imageUrl!}
                target="_blank"
                rel="noreferrer"
                download
                aria-label="Download"
                className="rounded-lg p-1.5 text-white/85 transition-colors hover:bg-white/20 hover:text-white"
              >
                <Download className="size-4" />
              </a>
              <div className="ml-auto flex items-center gap-0.5">{actions?.(gen)}</div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-3xl p-2">
          {gen.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={gen.imageUrl} alt="" className="mx-auto max-h-[82vh] w-auto rounded-xl" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Per-tile manual actions: refine product / refine logo / edit copy / save to library. */
export function GenActions({
  brandId,
  gen,
  canRefineProduct,
  canRefineLogo,
  onDone,
  onEdit,
}: {
  brandId: string;
  gen: Generation;
  canRefineProduct: boolean;
  canRefineLogo: boolean;
  onDone: () => void;
  onEdit?: (gen: Generation) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const post = async (kind: string, url: string, body: Record<string, unknown>, ok: string) => {
    setBusy(kind);
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    if (r.ok) {
      toast.success(ok);
      onDone();
    } else {
      toast.error(((await r.json().catch(() => ({}))) as { error?: string })?.error ?? "Action failed");
    }
  };

  const refine = (kind: "product" | "logo") =>
    post(kind, `/api/systems/static-generation/refine`, { brandId, generationId: gen.id, kind }, kind === "product" ? "Refining product…" : "Refining logo…");
  const save = () => post("save", `/api/systems/static-generation/save-reference`, { brandId, generationId: gen.id }, "Saved to library");

  return (
    <>
      {canRefineProduct && <IconAction label="Refine product" busy={busy === "product"} onClick={() => refine("product")} icon={<Package className="size-4" />} />}
      {canRefineLogo && <IconAction label="Refine logo" busy={busy === "logo"} onClick={() => refine("logo")} icon={<Stamp className="size-4" />} />}
      {onEdit && <IconAction label="Edit copy" busy={false} onClick={() => onEdit(gen)} icon={<Pencil className="size-4" />} />}
      <IconAction label="Save to library" busy={busy === "save"} onClick={save} icon={<BookmarkPlus className="size-4" />} />
    </>
  );
}

/** Glassy icon button sized for the dark hover scrim. */
function IconAction({ label, busy, onClick, icon }: { label: string; busy: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={busy}
          aria-label={label}
          className="rounded-lg p-1.5 text-white/85 transition-colors hover:bg-white/20 hover:text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
