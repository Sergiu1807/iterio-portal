"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Radar, Play, Loader2, Plus, Trash2, ExternalLink, Sparkles, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { useBrand } from "@/lib/brand-store";
import { cn } from "@/lib/utils";

type Ad = {
  id: string;
  adArchiveId: string;
  brandPageName: string | null;
  mediaType: string | null;
  thumbUrl: string | null;
  displayPrimaryText: string | null;
  ctaButtonType: string | null;
  destinationUrl: string | null;
  adLibraryUrl: string | null;
  dedupCount: number;
  creativeAngle: string | null;
  adDescription: string | null;
  targetPersona: string | null;
  coreMotivation: string | null;
  proofMechanism: string | null;
  visualHook: string | null;
  spokenHook: string | null;
  outroOffer: string | null;
  fullTranscript: string | null;
  geminiDescription: string | null;
  aiAnalysisStatus: string;
};
type Job = {
  id: string;
  status: string;
  mode: string;
  query: string;
  country: string;
  requestedCount: number;
  stats: { adsFound?: number; adsAnalyzed?: number };
  errorMessage: string | null;
  createdAt: string;
};
type Source = { id: string; name: string; metaPageId: string | null; metaSearchTerms: string | null; type: string | null };

const ACTIVE = ["pending", "running", "ingesting", "analyzing"];
const STATUS_LABEL: Record<string, string> = {
  pending: "Queued", running: "Scraping", ingesting: "Saving ads", analyzing: "Analyzing", complete: "Complete", error: "Error",
};

export default function CompetitorResearchSystem({ brandId }: { brandId: string }) {
  const { currentBrand } = useBrand();
  const [ads, setAds] = useState<Ad[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<Ad | null>(null);

  const [mode, setMode] = useState<"url" | "page_id" | "keyword">("url");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("ALL");
  const [count, setCount] = useState(20);
  const [running, setRunning] = useState(false);

  const activeJob = useMemo(() => jobs.find((j) => ACTIVE.includes(j.status)), [jobs]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/systems/competitor-research/jobs?brandId=${brandId}`);
    if (r.ok) {
      const d = await r.json();
      setJobs(d.jobs);
      setAds(d.ads);
    }
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

  const runScrape = async (override?: { mode: "url" | "page_id" | "keyword"; query: string }) => {
    const m = override?.mode ?? mode;
    const q = (override?.query ?? query).trim();
    if (!q) return;
    setRunning(true);
    const r = await fetch(`/api/systems/competitor-research/scrape`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, mode: m, query: q, country, requestedCount: count }),
    });
    setRunning(false);
    if (r.ok) {
      toast.success("Scrape started", { description: "Ads will appear here as they're scraped and analyzed." });
      load();
    } else {
      toast.error((await r.json().catch(() => ({})))?.error ?? "Couldn't start scrape");
    }
  };

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
          <TabsTrigger value="sources">Sources ({sources.length})</TabsTrigger>
        </TabsList>

        {/* LIBRARY */}
        <TabsContent value="library" className="space-y-5">
          <BentoCard className="p-5">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex rounded-full border border-border/70 bg-muted/60 p-1">
                {(["url", "page_id", "keyword"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "rounded-full px-3.5 py-1.5 text-sm font-medium transition-all",
                      mode === m ? "bg-card text-foreground shadow-[var(--shadow-xs)]" : "text-muted-foreground"
                    )}
                  >
                    {m === "url" ? "Ad Library URL" : m === "page_id" ? "Page ID" : "Keyword"}
                  </button>
                ))}
              </div>
              <div className="min-w-[240px] flex-1 space-y-1.5">
                <Label>{mode === "url" ? "Meta Ad Library URL" : mode === "page_id" ? "Facebook Page ID" : "Keyword"}</Label>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={mode === "url" ? "Paste facebook.com/ads/library/?…" : mode === "page_id" ? "e.g. 104958162563" : "e.g. collagen peptides"}
                  onKeyDown={(e) => e.key === "Enter" && runScrape()}
                />
              </div>
              {mode !== "url" && (
                <div className="w-24 space-y-1.5">
                  <Label>Country</Label>
                  <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="ALL" />
                </div>
              )}
              <div className="w-20 space-y-1.5">
                <Label>Count</Label>
                <Input type="number" value={count} min={1} max={50} onChange={(e) => setCount(Number(e.target.value))} />
              </div>
              <Button onClick={() => runScrape()} disabled={running || !query.trim()}>
                {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run scrape
              </Button>
            </div>
            {mode === "url" && (
              <p className="mt-3 text-xs text-muted-foreground">
                Open{" "}
                <a className="underline hover:text-foreground" href="https://www.facebook.com/ads/library/" target="_blank" rel="noreferrer">
                  facebook.com/ads/library
                </a>
                , search the competitor (or open one of their ads), then copy the address-bar URL and paste it here.
              </p>
            )}
            {activeJob && (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {STATUS_LABEL[activeJob.status]} — “{activeJob.query}”
                {activeJob.stats?.adsFound ? ` · ${activeJob.stats.adsFound} ads found` : ""}
              </p>
            )}
          </BentoCard>

          {ads.length === 0 ? (
            <EmptyState
              icon={Radar}
              title="No competitor ads yet"
              description="Run a scrape on a competitor's Facebook Page ID or a keyword to pull their live Meta ads and analyze them."
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {ads.map((ad) => (
                <button key={ad.id} onClick={() => setSelected(ad)} className="group text-left">
                  <BentoCard interactive className="flex h-full flex-col overflow-hidden p-0">
                    <div className="relative aspect-square w-full overflow-hidden bg-muted">
                      {ad.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ad.thumbUrl} alt="" className="size-full object-cover transition-transform group-hover:scale-105" />
                      ) : (
                        <div className="flex size-full items-center justify-center text-muted-foreground">
                          <Radar className="size-6" />
                        </div>
                      )}
                      <div className="absolute left-2 top-2 flex gap-1.5">
                        {ad.mediaType && <Badge variant="muted" className="bg-card/85 backdrop-blur">{ad.mediaType}</Badge>}
                        {ad.dedupCount > 1 && <Badge variant="accent" className="bg-card/85 backdrop-blur">×{ad.dedupCount}</Badge>}
                      </div>
                      {ad.aiAnalysisStatus !== "complete" && (
                        <div className="absolute right-2 top-2">
                          <Badge variant={ad.aiAnalysisStatus === "failed" ? "warning" : "soon"} className="bg-card/85 backdrop-blur">
                            {ad.aiAnalysisStatus === "failed" ? "analysis failed" : "analyzing…"}
                          </Badge>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-3">
                      <p className="truncate text-xs font-medium">{ad.brandPageName ?? "Unknown advertiser"}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {ad.creativeAngle ?? ad.displayPrimaryText ?? "—"}
                      </p>
                    </div>
                  </BentoCard>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* SOURCES */}
        <TabsContent value="sources">
          <SourcesManager brandId={brandId} sources={sources} reload={loadSources} onRun={(s) => runScrape(s)} />
        </TabsContent>
      </Tabs>

      <AdDetailSheet ad={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function SourcesManager({
  brandId,
  sources,
  reload,
  onRun,
}: {
  brandId: string;
  sources: Source[];
  reload: () => void;
  onRun: (s: { mode: "page_id" | "keyword"; query: string }) => void;
}) {
  const [name, setName] = useState("");
  const [pageId, setPageId] = useState("");

  const add = async () => {
    if (!name.trim()) return;
    const r = await fetch(`/api/systems/competitor-research/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, name, metaPageId: pageId }),
    });
    if (r.ok) {
      setName("");
      setPageId("");
      reload();
    }
  };
  const remove = async (id: string) => {
    await fetch(`/api/systems/competitor-research/sources`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    reload();
  };

  return (
    <div className="space-y-4">
      <BentoCard className="flex flex-wrap items-end gap-3 p-5">
        <div className="min-w-[180px] flex-1 space-y-1.5">
          <Label>Competitor name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ritual" />
        </div>
        <div className="min-w-[180px] flex-1 space-y-1.5">
          <Label>Facebook Page ID</Label>
          <Input value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="numeric page id" />
        </div>
        <Button variant="outline" onClick={add} disabled={!name.trim()}>
          <Plus className="size-4" /> Add competitor
        </Button>
      </BentoCard>

      {sources.length === 0 ? (
        <EmptyState icon={Plus} title="No competitors tracked" description="Add a competitor with their Facebook Page ID to scrape their ads in one click." />
      ) : (
        <div className="space-y-2.5">
          {sources.map((s) => (
            <BentoCard key={s.id} className="group flex items-center gap-3 p-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{s.name}</h3>
                  {s.type && <Badge variant="muted">{s.type}</Badge>}
                </div>
                {s.metaPageId && <code className="font-mono text-[11px] text-muted-foreground">page {s.metaPageId}</code>}
              </div>
              {s.metaPageId && (
                <Button size="sm" variant="outline" onClick={() => onRun({ mode: "page_id", query: s.metaPageId! })}>
                  <Play className="size-3.5" /> Scrape
                </Button>
              )}
              <Button size="iconSm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => remove(s.id)} aria-label="Remove">
                <Trash2 className="size-4" />
              </Button>
            </BentoCard>
          ))}
        </div>
      )}
    </div>
  );
}

function AdDetailSheet({ ad, onClose }: { ad: Ad | null; onClose: () => void }) {
  return (
    <Sheet open={!!ad} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-2xl">
        {ad && (
          <>
            <SheetHeader>
              <SheetTitle>{ad.brandPageName ?? "Competitor ad"}</SheetTitle>
              <SheetDescription>{ad.mediaType} · seen ×{ad.dedupCount}</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-5">
              {ad.thumbUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ad.thumbUrl} alt="" className="w-full rounded-xl border border-border/60" />
              )}
              {ad.displayPrimaryText && (
                <Field label="Ad copy" value={ad.displayPrimaryText} />
              )}
              {ad.aiAnalysisStatus === "complete" ? (
                <div className="space-y-3 rounded-2xl border border-border/60 bg-surface p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="size-4 text-primary" /> AI breakdown
                  </div>
                  <Field label="Creative angle" value={ad.creativeAngle} />
                  <Field label="Description" value={ad.adDescription} />
                  <Field label="Target persona" value={ad.targetPersona} />
                  <Field label="Core motivation" value={ad.coreMotivation} />
                  <Field label="Proof mechanism" value={ad.proofMechanism} />
                  <Field label="Visual hook" value={ad.visualHook} />
                  <Field label="Spoken hook" value={ad.spokenHook} />
                  <Field label="Outro / offer" value={ad.outroOffer} />
                  <Field label="Transcript" value={ad.fullTranscript} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {ad.aiAnalysisStatus === "failed" ? "Analysis failed for this ad." : "Analysis in progress…"}
                </p>
              )}
              <div className="flex gap-2">
                {ad.adLibraryUrl && (
                  <Button asChild variant="outline" size="sm">
                    <a href={ad.adLibraryUrl} target="_blank" rel="noreferrer">
                      Ad Library <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                )}
                {ad.destinationUrl && (
                  <Button asChild variant="ghost" size="sm">
                    <a href={ad.destinationUrl} target="_blank" rel="noreferrer">
                      Landing page <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                )}
              </div>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm leading-relaxed text-foreground/85">{value}</p>
    </div>
  );
}
