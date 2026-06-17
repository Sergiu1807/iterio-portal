"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReferenceItem } from "./ui-types";

export function LibraryTab({ brandId }: { brandId: string }) {
  const [refs, setRefs] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/systems/static-generation/references?brandId=${brandId}`);
    if (r.ok) setRefs(((await r.json()) as { references: ReferenceItem[] }).references);
    setLoading(false);
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.append("brandId", brandId);
    fd.append("file", file);
    const r = await fetch(`/api/systems/static-generation/references`, { method: "POST", body: fd });
    setUploading(false);
    if (r.ok) {
      toast.success("Reference added");
      load();
    } else {
      toast.error(((await r.json().catch(() => ({}))) as { error?: string })?.error ?? "Upload failed");
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/systems/static-generation/references?id=${id}&brandId=${brandId}`, { method: "DELETE" });
    setRefs((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Reference images this brand’s ads follow for style & composition.</p>
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
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-2xl shimmer" />
          ))}
        </div>
      ) : refs.length === 0 ? (
        <div className="results-canvas flex min-h-[44vh] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            <ImagePlus className="size-6" />
          </span>
          <p className="max-w-sm text-sm text-muted-foreground">No references yet. Upload a few ads whose style you want to echo, or use “Save to library” on a generated result.</p>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} Upload a reference
          </Button>
        </div>
      ) : (
        <div className="stagger grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
          {refs.map((ref) => (
            <div
              key={ref.id}
              className="group relative aspect-square overflow-hidden rounded-2xl border border-border/60 bg-muted shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]"
            >
              {ref.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ref.url} alt={ref.name ?? ""} loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" onError={load} />
              ) : null}
              <button
                onClick={() => remove(ref.id)}
                className="absolute right-2 top-2 rounded-full bg-card/85 p-1.5 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-destructive group-hover:opacity-100"
                aria-label="Delete reference"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
