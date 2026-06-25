"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Lightbulb, Wand2, Library } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useBrand } from "@/lib/brand-store";
import { CreateTab } from "./create-tab";
import { LibraryTab } from "./library-tab";
import type { IdeationAngle, IdeationBatch } from "./ui-types";

const ACTIVE = ["pending", "running"];

export default function IdeationSystem({ brandId }: { brandId: string }) {
  const { currentBrand } = useBrand();
  const [angles, setAngles] = useState<IdeationAngle[]>([]);
  const [batches, setBatches] = useState<IdeationBatch[]>([]);
  const [tab, setTab] = useState("create");
  const [loaded, setLoaded] = useState(false);

  const loadData = useCallback(async () => {
    const r = await fetch(`/api/systems/ideation/angles?brandId=${brandId}`);
    if (r.ok) {
      const d = (await r.json()) as { angles: IdeationAngle[]; batches: IdeationBatch[] };
      setAngles(d.angles ?? []);
      setBatches(d.batches ?? []);
    }
    setLoaded(true);
  }, [brandId]);

  useEffect(() => { setLoaded(false); loadData(); }, [loadData]);

  const activeCount = useMemo(() => batches.filter((b) => ACTIVE.includes(b.status)).length, [batches]);

  // Drive in-flight batches forward (cron is the prod backstop).
  useEffect(() => {
    if (activeCount === 0) return;
    let cancelled = false;
    const pump = async () => {
      await fetch(`/api/systems/ideation/tick`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId }) }).catch(() => {});
      if (!cancelled) await loadData();
    };
    pump();
    const iv = setInterval(pump, 4000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [activeCount, brandId, loadData]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-5">
      <BentoCard inset={false} className="brand-wash relative overflow-hidden border-border/60 px-5 py-4 md:px-7 md:py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <Lightbulb className="size-3.5" /> {currentBrand?.name ? `${currentBrand.name} · Ideation` : "Ideation"}
            </p>
            <h1 className="font-display letterpress text-2xl font-semibold tracking-tight md:text-[28px]">Angle &amp; Concept Generator</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {activeCount > 0 && (
              <Badge variant="warning" className="gap-1.5"><Loader2 className="size-3 animate-spin" /> {activeCount} generating</Badge>
            )}
            <TabsList className="flex-wrap">
              <TabsTrigger value="create"><Wand2 className="size-3.5" /> Create</TabsTrigger>
              <TabsTrigger value="library"><Library className="size-3.5" /> Library ({angles.length})</TabsTrigger>
            </TabsList>
          </div>
        </div>
      </BentoCard>

      <TabsContent value="create" className="mt-0">
        <CreateTab
          brandId={brandId}
          products={currentBrand?.products ?? []}
          onGenerated={() => { setTab("library"); loadData(); }}
        />
      </TabsContent>
      <TabsContent value="library" className="mt-0">
        <LibraryTab brandId={brandId} angles={angles} batches={batches} loaded={loaded} reload={loadData} />
      </TabsContent>
    </Tabs>
  );
}
