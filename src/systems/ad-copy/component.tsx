"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, PenSquare, Wand2, Library } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useBrand } from "@/lib/brand-store";
import { CreateTab } from "./create-tab";
import { LibraryTab } from "./library-tab";
import type { AdCopy, AdCopyBatch } from "./ui-types";

const ACTIVE = ["pending", "running"];

export default function AdCopySystem({ brandId }: { brandId: string }) {
  const { currentBrand } = useBrand();
  const [copy, setCopy] = useState<AdCopy[]>([]);
  const [batches, setBatches] = useState<AdCopyBatch[]>([]);
  const [tab, setTab] = useState("create");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/systems/ad-copy/copy?brandId=${brandId}`);
    if (r.ok) { const d = (await r.json()) as { copy: AdCopy[]; batches: AdCopyBatch[] }; setCopy(d.copy ?? []); setBatches(d.batches ?? []); }
    setLoaded(true);
  }, [brandId]);

  useEffect(() => { setLoaded(false); load(); }, [load]);
  useEffect(() => { if (loaded && copy.length > 0) setTab((t) => (t === "create" ? "library" : t)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [loaded]);

  const activeCount = useMemo(() => batches.filter((b) => ACTIVE.includes(b.status)).length, [batches]);
  useEffect(() => {
    if (activeCount === 0) return;
    let cancelled = false;
    const pump = async () => {
      await fetch(`/api/systems/ad-copy/tick`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId }) }).catch(() => {});
      if (!cancelled) await load();
    };
    pump();
    const iv = setInterval(pump, 4000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [activeCount, brandId, load]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-5">
      <BentoCard inset={false} className="brand-wash relative overflow-hidden border-border/60 px-5 py-4 md:px-7 md:py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground"><PenSquare className="size-3.5" /> {currentBrand?.name ? `${currentBrand.name} · Copy` : "Ad Copy"}</p>
            <h1 className="font-display letterpress text-2xl font-semibold tracking-tight md:text-[28px]">Ad Copy Generator</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {activeCount > 0 && <Badge variant="warning" className="gap-1.5"><Loader2 className="size-3 animate-spin" /> generating</Badge>}
            <TabsList className="flex-wrap">
              <TabsTrigger value="create"><Wand2 className="size-3.5" /> Create</TabsTrigger>
              <TabsTrigger value="library"><Library className="size-3.5" /> Library ({copy.length})</TabsTrigger>
            </TabsList>
          </div>
        </div>
      </BentoCard>

      <TabsContent value="create" className="mt-0"><CreateTab brandId={brandId} onGenerated={() => { setTab("library"); load(); }} /></TabsContent>
      <TabsContent value="library" className="mt-0"><LibraryTab brandId={brandId} copy={copy} batches={batches} loaded={loaded} reload={load} /></TabsContent>
    </Tabs>
  );
}
