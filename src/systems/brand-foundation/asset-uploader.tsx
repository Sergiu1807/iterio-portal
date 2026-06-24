"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, Trash2, FileText } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { BrandAsset } from "./ui-types";
import { ASSET_SLOTS } from "./ui-utils";

export function AssetUploader({ brandId }: { brandId: string }) {
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/brand-foundation/assets?brandId=${brandId}`);
    if (r.ok) setAssets(((await r.json()) as { assets: BrandAsset[] }).assets);
  }, [brandId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (type: string, files: FileList) => {
    setBusy(type);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("brandId", brandId);
      fd.append("type", type);
      fd.append("file", file);
      const r = await fetch(`/api/brand-foundation/assets`, { method: "POST", body: fd });
      if (!r.ok) toast.error(((await r.json().catch(() => ({}))) as { error?: string })?.error ?? `Couldn't upload ${file.name}`);
    }
    setBusy(null);
    await load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/brand-foundation/assets`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, brandId }) });
    setAssets((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {ASSET_SLOTS.map((slot) => (
        <AssetSlot key={slot.type} slot={slot} assets={assets.filter((a) => a.type === slot.type)} busy={busy === slot.type} onUpload={(f) => upload(slot.type, f)} onRemove={remove} />
      ))}
    </div>
  );
}

function AssetSlot({
  slot,
  assets,
  busy,
  onUpload,
  onRemove,
}: {
  slot: { type: string; label: string; accept: string; multi: boolean };
  assets: BrandAsset[];
  busy: boolean;
  onUpload: (files: FileList) => void;
  onRemove: (id: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <BentoCard className="space-y-2.5 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{slot.label}</span>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => ref.current?.click()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Upload
        </Button>
        <input
          ref={ref}
          type="file"
          accept={slot.accept}
          multiple={slot.multi}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onUpload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {assets.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {assets.map((a) => {
            const isImg = (a.meta?.contentType as string | undefined)?.startsWith("image/") ?? slot.accept.includes("image");
            return (
              <div key={a.id} className="group relative">
                {isImg && a.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt="" className="size-16 rounded-lg border border-border/70 object-cover" />
                ) : (
                  <span className="flex size-16 items-center justify-center rounded-lg border border-border/70 bg-muted text-muted-foreground">
                    <FileText className="size-5" />
                  </span>
                )}
                <button
                  onClick={() => onRemove(a.id)}
                  className="absolute -right-1.5 -top-1.5 hidden size-5 items-center justify-center rounded-full bg-destructive text-white group-hover:flex"
                  aria-label="Remove"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">None yet.</p>
      )}
    </BentoCard>
  );
}
