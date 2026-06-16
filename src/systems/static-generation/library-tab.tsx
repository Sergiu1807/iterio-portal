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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-2xl bg-muted/60" />
          ))}
        </div>
      ) : refs.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
          No references yet. Upload a few ads whose style you want to echo, or use “Save to library” on a generated result.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {refs.map((ref) => (
            <div key={ref.id} className="group relative aspect-square overflow-hidden rounded-2xl border border-border/60 bg-muted">
              {ref.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ref.url} alt={ref.name ?? ""} loading="lazy" className="size-full object-cover" onError={load} />
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
