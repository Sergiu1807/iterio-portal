"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VideoRef } from "./ui-types";

/** Per-brand Characters / Scenes library (upload, list, delete). */
export function RefLibrary({ brandId, kind }: { brandId: string; kind: "characters" | "scenes" }) {
  const endpoint = `/api/systems/video-generation/${kind}`;
  const noun = kind === "characters" ? "character" : "scene";
  const [items, setItems] = useState<VideoRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch(`${endpoint}?brandId=${brandId}`);
    if (r.ok) setItems(((await r.json()) as { items: VideoRef[] }).items);
    setLoading(false);
  }, [brandId, endpoint]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.append("brandId", brandId);
    fd.append("file", file);
    fd.append("name", file.name.replace(/\.[^.]+$/, ""));
    const r = await fetch(endpoint, { method: "POST", body: fd });
    setUploading(false);
    if (r.ok) {
      toast.success(`${noun[0].toUpperCase() + noun.slice(1)} added`);
      load();
    } else {
      toast.error(((await r.json().catch(() => ({}))) as { error?: string })?.error ?? "Upload failed");
    }
  };

  const remove = async (id: string) => {
    await fetch(`${endpoint}?id=${id}&brandId=${brandId}`, { method: "DELETE" });
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {kind === "characters"
            ? "Reusable talent refs for UGC-with-character and A-Roll spots."
            : "Backdrops / locations for A-Roll podcast scenes."}
        </p>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} Upload
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </div>

      {loading ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-2xl shimmer" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="results-canvas flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            <ImagePlus className="size-6" />
          </span>
          <p className="max-w-sm text-sm text-muted-foreground">No {noun}s yet. Upload reference images to reuse across your video spots.</p>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} Upload a {noun}
          </Button>
        </div>
      ) : (
        <div className="stagger grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
          {items.map((item) => (
            <div key={item.id} className="group overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]">
              <div className="relative aspect-square overflow-hidden bg-muted">
                {item.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt={item.name} loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" onError={load} />
                ) : null}
                <button
                  onClick={() => remove(item.id)}
                  className="absolute right-2 top-2 rounded-full bg-card/85 p-1.5 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-destructive group-hover:opacity-100"
                  aria-label={`Delete ${noun}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <p className="truncate px-3 py-2 text-xs font-medium">{item.name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
