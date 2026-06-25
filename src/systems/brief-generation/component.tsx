"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, FileText, Wand2, Library } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useBrand } from "@/lib/brand-store";
import { CreateTab } from "./create-tab";
import { LibraryTab } from "./library-tab";
import { BRIEF_PREFILL_KEY } from "./bridge";
import type { Brief } from "./ui-types";

const ACTIVE = ["pending", "running"];

export default function BriefGenerationSystem({ brandId }: { brandId: string }) {
  const { currentBrand } = useBrand();
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [tab, setTab] = useState("create");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/systems/brief-generation/briefs?brandId=${brandId}`);
    if (r.ok) setBriefs(((await r.json()) as { briefs: Brief[] }).briefs ?? []);
    setLoaded(true);
  }, [brandId]);

  useEffect(() => { setLoaded(false); load(); }, [load]);
  // Land on Library unless we arrived via a send-to-brief handoff (prefill present).
  useEffect(() => {
    const hasPrefill = typeof window !== "undefined" && !!sessionStorage.getItem(BRIEF_PREFILL_KEY);
    if (!hasPrefill && loaded && briefs.length > 0) setTab("library");
  }, [loaded, briefs.length]);

  const activeCount = useMemo(() => briefs.filter((b) => ACTIVE.includes(b.status)).length, [briefs]);
  useEffect(() => {
    if (activeCount === 0) return;
    let cancelled = false;
    const pump = async () => {
      await fetch(`/api/systems/brief-generation/tick`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId }) }).catch(() => {});
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
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <FileText className="size-3.5" /> {currentBrand?.name ? `${currentBrand.name} · Briefs` : "Briefs"}
            </p>
            <h1 className="font-display letterpress text-2xl font-semibold tracking-tight md:text-[28px]">Brief Generator</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {activeCount > 0 && <Badge variant="warning" className="gap-1.5"><Loader2 className="size-3 animate-spin" /> {activeCount} generating</Badge>}
            <TabsList className="flex-wrap">
              <TabsTrigger value="create"><Wand2 className="size-3.5" /> Create</TabsTrigger>
              <TabsTrigger value="library"><Library className="size-3.5" /> Library ({briefs.length})</TabsTrigger>
            </TabsList>
          </div>
        </div>
      </BentoCard>

      <TabsContent value="create" className="mt-0">
        <CreateTab brandId={brandId} onGenerated={() => { setTab("library"); load(); }} />
      </TabsContent>
      <TabsContent value="library" className="mt-0">
        <LibraryTab brandId={brandId} briefs={briefs} loaded={loaded} reload={load} />
      </TabsContent>
    </Tabs>
  );
}
