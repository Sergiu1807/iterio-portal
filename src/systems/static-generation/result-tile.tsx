"use client";

import { useState } from "react";
import { Loader2, AlertTriangle, Maximize2, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
    <div className="group overflow-hidden rounded-2xl border border-border/60 bg-card">
      <div className={cn("relative w-full overflow-hidden bg-muted", aspectClass(gen.aspectRatio))}>
        {done ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={gen.imageUrl!}
              alt=""
              loading="lazy"
              className="size-full object-cover"
              onError={() => {
                if (!reSigned) {
                  setReSigned(true);
                  onReload(); // signed URL likely expired — refetch fresh ones
                }
              }}
            />
            <button
              onClick={() => setZoom(true)}
              className="absolute inset-0 flex items-center justify-center bg-foreground/0 opacity-0 transition-all group-hover:bg-foreground/15 group-hover:opacity-100"
              aria-label="Expand"
            >
              <Maximize2 className="size-5 text-white drop-shadow" />
            </button>
          </>
        ) : gen.status === "error" ? (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 p-4 text-center">
            <AlertTriangle className="size-6 text-destructive/70" />
            <p className="text-xs text-muted-foreground line-clamp-3" title={gen.errorMessage ?? undefined}>
              {gen.errorMessage ?? "Generation failed"}
            </p>
          </div>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            <span className="text-xs">{statusLabel(gen.status)}…</span>
          </div>
        )}
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-card/85 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur">
          {gen.aspectRatio}
        </span>
        {gen.mode !== "custom" && (
          <span className="absolute right-2 top-2">
            <Badge variant="muted" className="bg-card/85 backdrop-blur">
              {modeLabel(gen.mode)}
            </Badge>
          </span>
        )}
      </div>

      {done && (
        <div className="flex items-center gap-1 px-2 py-1.5">
          <a
            href={gen.imageUrl!}
            target="_blank"
            rel="noreferrer"
            download
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Download className="size-3.5" /> Save
          </a>
          <div className="ml-auto flex items-center gap-1">{actions?.(gen)}</div>
        </div>
      )}

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
