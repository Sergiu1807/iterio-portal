"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Wand2, Film } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useBrand } from "@/lib/brand-store";
import { CreateTab } from "./create-tab";
import { GalleryTab } from "./gallery-tab";
import { isActive } from "./ui-utils";
import type { VideoGen } from "./ui-types";

export default function VideoGenerationSystem({ brandId }: { brandId: string }) {
  const { currentBrand } = useBrand();
  const [generations, setGenerations] = useState<VideoGen[]>([]);

  const loadGenerations = useCallback(async () => {
    const r = await fetch(`/api/systems/video-generation/generations?brandId=${brandId}`);
    if (r.ok) setGenerations(((await r.json()) as { generations: VideoGen[] }).generations);
  }, [brandId]);

  useEffect(() => {
    setGenerations([]);
    loadGenerations();
  }, [loadGenerations]);

  const activeCount = useMemo(() => generations.filter(isActive).length, [generations]);

  // Drive in-flight renders forward (cron is the prod backstop).
  useEffect(() => {
    if (activeCount === 0) return;
    let cancelled = false;
    const pump = async () => {
      await fetch(`/api/systems/video-generation/tick`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId }),
      }).catch(() => {});
      if (!cancelled) await loadGenerations();
    };
    pump();
    const iv = setInterval(pump, 5000); // video renders are slower than images
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [activeCount, brandId, loadGenerations]);

  return (
    <Tabs defaultValue="create" className="space-y-5">
      <BentoCard inset={false} className="brand-wash relative overflow-hidden border-border/60 px-5 py-4 md:px-7 md:py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {currentBrand?.name ? `${currentBrand.name} · Studio` : "Video Studio"}
            </p>
            <h1 className="font-display letterpress text-2xl font-semibold tracking-tight md:text-[28px]">Video Generation</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {activeCount > 0 ? (
              <Badge variant="warning" className="gap-1.5">
                <Loader2 className="size-3 animate-spin" /> {activeCount} rendering
              </Badge>
            ) : (
              <Badge variant="muted" className="gap-1.5">
                <Film className="size-3" /> Seedance 2
              </Badge>
            )}
            <TabsList className="flex-wrap">
              <TabsTrigger value="create"><Wand2 className="size-3.5" /> Create</TabsTrigger>
              <TabsTrigger value="gallery"><Film className="size-3.5" /> Gallery ({generations.length})</TabsTrigger>
            </TabsList>
          </div>
        </div>
      </BentoCard>

      <TabsContent value="create" className="mt-0">
        <CreateTab brandId={brandId} generations={generations} reload={loadGenerations} />
      </TabsContent>
      <TabsContent value="gallery" className="mt-0">
        <GalleryTab generations={generations} reload={loadGenerations} />
      </TabsContent>
    </Tabs>
  );
}
