"use client";

import { useState } from "react";
import { Loader2, AlertTriangle, Maximize2, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { VideoGen } from "./ui-types";
import { videoAspectClass, modeLabel, statusLabel, durationLabel } from "./ui-utils";

/** One generated-video tile: player / shimmer / error, with a lightbox. */
export function VideoTile({ gen, onReload }: { gen: VideoGen; onReload: () => void }) {
  const [zoom, setZoom] = useState(false);
  const [reSigned, setReSigned] = useState(false);
  const done = gen.status === "completed" && !!gen.videoUrl;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]">
      <div className={cn("relative w-full overflow-hidden bg-muted", videoAspectClass(gen.aspectRatio))}>
        {done ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={gen.videoUrl!}
            poster={gen.thumbUrl ?? undefined}
            controls
            preload="metadata"
            className="size-full animate-scale-in object-cover"
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

        <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-card/85 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur">{gen.aspectRatio}</span>
          <span className="rounded-md bg-card/85 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur">{durationLabel(gen.duration)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-2">
        <Badge variant="muted">{modeLabel(gen)}</Badge>
        {done && (
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => setZoom(true)} aria-label="Expand" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Maximize2 className="size-4" />
            </button>
            <a
              href={gen.videoUrl!}
              target="_blank"
              rel="noreferrer"
              download
              aria-label="Download"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Download className="size-4" />
            </a>
          </div>
        )}
      </div>

      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-2xl p-2">
          {gen.videoUrl && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={gen.videoUrl} poster={gen.thumbUrl ?? undefined} controls autoPlay className="mx-auto max-h-[82vh] w-auto rounded-xl" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
