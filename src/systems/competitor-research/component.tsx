"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useBrand } from "@/lib/brand-store";
import type { Ad, Job, Source, Concept } from "./ui-types";
import { WinnerBoardTab } from "./winner-board-tab";
import { LibraryTab } from "./library-tab";
import { CompetitorsTab } from "./competitors-tab";
import { AdDetailModal } from "./ad-detail-modal";

const ACTIVE = ["pending", "running", "ingesting", "analyzing", "scoring"];
const STATUS_LABEL: Record<string, string> = {
  pending: "Queued", running: "Scraping", ingesting: "Saving ads", analyzing: "Analyzing", scoring: "Scoring",
};

type RunArgs = { mode: "url" | "page_id" | "keyword"; query: string; country: string; count: number; competitorId?: string };

export default function CompetitorResearchSystem({ brandId }: { brandId: string }) {
  const { currentBrand } = useBrand();
  const [ads, setAds] = useState<Ad[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [momentum, setMomentum] = useState<Concept[]>([]);
  const [savedConceptIds, setSavedConceptIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [conceptsLoading, setConceptsLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState(20); // ads-per-scrape, shared by quick-scrape + per-source refresh
  const [selected, setSelected] = useState<Ad | null>(null);

  const activeJob = useMemo(() => jobs.find((j) => ACTIVE.includes(j.status)) ?? null, [jobs]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/systems/competitor-research/jobs?brandId=${brandId}`);
    if (r.ok) {
      const d = await r.json();
      setJobs(d.jobs);
      setAds(d.ads);
    }
    setLoading(false);
  }, [brandId]);

  const loadConcepts = useCallback(async () => {
    const r = await fetch(`/api/systems/competitor-research/concepts?brandId=${brandId}`);
    if (r.ok) {
      const d = await r.json();
      setConcepts(d.concepts);
      setMomentum(d.momentum);
    }
    setConceptsLoading(false);
  }, [brandId]);

  const loadSources = useCallback(async () => {
    const r = await fetch(`/api/systems/competitor-research/sources?brandId=${brandId}`);
    if (r.ok) setSources((await r.json()).sources);
  }, [brandId]);

  const loadSwipes = useCallback(async () => {
    const r = await fetch(`/api/systems/competitor-research/swipe?brandId=${brandId}`);
    if (r.ok) {
      const d = (await r.json()) as { items: { conceptId: string | null }[] };
      setSavedConceptIds(new Set(d.items.map((i) => i.conceptId).filter((id): id is string => !!id)));
    }
  }, [brandId]);

  useEffect(() => {
    load();
    loadConcepts();
    loadSources();
    loadSwipes();
  }, [load, loadConcepts, loadSources, loadSwipes]);

  // Drive the pipeline forward while a job is active (cron is the prod backstop).
  useEffect(() => {
    if (!activeJob) return;
    let cancelled = false;
    const pump = async () => {
      await fetch(`/api/systems/competitor-research/tick`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId }),
      }).catch(() => {});
      if (!cancelled) {
        await load();
        await loadConcepts();
      }
    };
    pump(); // leading call — no 4s dead window on first activation
    const iv = setInterval(pump, 4000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [activeJob, brandId, load, loadConcepts]);

  const runScrape = useCallback(
    async (args: RunArgs) => {
      if (!args.query.trim()) return;
      setRunning(true);
      const res = await fetch(`/api/systems/competitor-research/scrape`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId, mode: args.mode, query: args.query, country: args.country, requestedCount: args.count, competitorId: args.competitorId }),
      });
      setRunning(false);
      if (res.ok) {
        toast.success("Scrape started", { description: "Ads stream in, get analyzed, then ranked on the Winner Board." });
        load();
      } else {
        toast.error((await res.json().catch(() => ({})))?.error ?? "Couldn't start scrape");
      }
    },
    [brandId, load]
  );

  const refreshSource = useCallback(
    (s: Source) => {
      if (!s.metaLibraryUrl) return;
      runScrape({ mode: "url", query: s.metaLibraryUrl, country: s.country ?? "ALL", count, competitorId: s.id }).then(() => loadSources());
    },
    [runScrape, loadSources, count]
  );

  // Drill from a concept into its raw variants (reuse the existing ad modal).
  const onViewVariants = useCallback(
    (c: Concept) => {
      const ad = ads.find((a) => c.variantAdIds.includes(a.id));
      if (ad) setSelected(ad);
      else toast.message("Open the Ad Library tab to inspect this concept's variants.");
    },
    [ads]
  );

  const onSaveSwipe = useCallback(
    async (conceptId: string) => {
      setSavedConceptIds((prev) => new Set(prev).add(conceptId)); // optimistic
      const res = await fetch(`/api/systems/competitor-research/swipe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId, conceptId }),
      });
      if (res.ok) toast.success("Saved to swipe library");
      else {
        setSavedConceptIds((prev) => {
          const n = new Set(prev);
          n.delete(conceptId);
          return n;
        });
        toast.error((await res.json().catch(() => ({})))?.error ?? "Couldn't save");
      }
    },
    [brandId]
  );

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Research"
        title="Competitor Research"
        description={`Scrape, score and break down competitor Meta ads${currentBrand ? ` for ${currentBrand.name}` : ""} — a competitive creative radar.`}
        actions={
          activeJob ? (
            <Badge variant="warning" className="gap-1.5">
              <Loader2 className="size-3 animate-spin" /> {STATUS_LABEL[activeJob.status] ?? activeJob.status}
            </Badge>
          ) : null
        }
      />

      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">Winner Board ({concepts.length})</TabsTrigger>
          <TabsTrigger value="library">Ad Library ({ads.length})</TabsTrigger>
          <TabsTrigger value="competitors">Competitors ({sources.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="board">
          <WinnerBoardTab
            brandId={brandId}
            concepts={concepts}
            momentum={momentum}
            loading={conceptsLoading}
            hasActiveJob={!!activeJob}
            onViewVariants={onViewVariants}
            onSaveSwipe={onSaveSwipe}
            savedConceptIds={savedConceptIds}
          />
        </TabsContent>

        <TabsContent value="library">
          <LibraryTab ads={ads} loading={loading} activeJob={activeJob} running={running} count={count} setCount={setCount} onRunScrape={runScrape} onSelect={setSelected} />
        </TabsContent>

        <TabsContent value="competitors">
          <CompetitorsTab
            brandId={brandId}
            sources={sources}
            reload={loadSources}
            onRefresh={refreshSource}
            onDiscovered={() => {
              loadSources();
              load();
            }}
            count={count}
            setCount={setCount}
          />
        </TabsContent>
      </Tabs>

      <AdDetailModal key={selected?.id ?? "none"} ad={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
