"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useBrand } from "@/lib/brand-store";
import type { Ad, Job, Source } from "./ui-types";
import { LibraryTab } from "./library-tab";
import { CompetitorsTab } from "./competitors-tab";
import { AdDetailModal } from "./ad-detail-modal";

const ACTIVE = ["pending", "running", "ingesting", "analyzing"];
const STATUS_LABEL: Record<string, string> = {
  pending: "Queued", running: "Scraping", ingesting: "Saving ads", analyzing: "Analyzing",
};

type RunArgs = { mode: "url" | "page_id" | "keyword"; query: string; country: string; count: number; competitorId?: string };

export default function CompetitorResearchSystem({ brandId }: { brandId: string }) {
  const { currentBrand } = useBrand();
  const [ads, setAds] = useState<Ad[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
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

  const loadSources = useCallback(async () => {
    const r = await fetch(`/api/systems/competitor-research/sources?brandId=${brandId}`);
    if (r.ok) setSources((await r.json()).sources);
  }, [brandId]);

  useEffect(() => {
    load();
    loadSources();
  }, [load, loadSources]);

  // Drive the pipeline forward while a job is active (cron is the prod backstop).
  useEffect(() => {
    if (!activeJob) return;
    const iv = setInterval(async () => {
      await fetch(`/api/systems/competitor-research/tick`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId }),
      }).catch(() => {});
      await load();
    }, 4000);
    return () => clearInterval(iv);
  }, [activeJob, brandId, load]);

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
        toast.success("Scrape started", { description: "Ads stream in here as they're scraped and analyzed." });
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

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Research"
        title="Competitor Research"
        description={`Scrape and analyze competitor Meta ads${currentBrand ? ` for ${currentBrand.name}` : ""} — code-native, no n8n.`}
        actions={
          activeJob ? (
            <Badge variant="warning" className="gap-1.5">
              <Loader2 className="size-3 animate-spin" /> {STATUS_LABEL[activeJob.status] ?? activeJob.status}
            </Badge>
          ) : null
        }
      />

      <Tabs defaultValue="library">
        <TabsList>
          <TabsTrigger value="library">Ad Library ({ads.length})</TabsTrigger>
          <TabsTrigger value="competitors">Competitors ({sources.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="library">
          <LibraryTab ads={ads} loading={loading} activeJob={activeJob} running={running} count={count} setCount={setCount} onRunScrape={runScrape} onSelect={setSelected} />
        </TabsContent>

        <TabsContent value="competitors">
          <CompetitorsTab brandId={brandId} sources={sources} reload={loadSources} onRefresh={refreshSource} count={count} setCount={setCount} />
        </TabsContent>
      </Tabs>

      <AdDetailModal ad={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
