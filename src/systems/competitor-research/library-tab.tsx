"use client";

import { useMemo, useState } from "react";
import { Play, Image as ImageIcon, Layout, FileText, Loader2, Search, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import type { Ad, Job } from "./ui-types";
import { longevityBadge, mediaLabel, MEDIA_TYPES, AD_COUNTS } from "./ui-utils";

const MEDIA_ICON: Record<string, React.ReactNode> = {
  video: <Play className="size-3" />,
  image: <ImageIcon className="size-3" />,
  carousel: <Layout className="size-3" />,
  text: <FileText className="size-3" />,
};

type RunArgs = { mode: "url" | "page_id" | "keyword"; query: string; country: string; count: number };

export function LibraryTab({
  ads,
  loading,
  activeJob,
  running,
  count,
  setCount,
  onRunScrape,
  onSelect,
}: {
  ads: Ad[];
  loading: boolean;
  activeJob: Job | null;
  running: boolean;
  count: number;
  setCount: (n: number) => void;
  onRunScrape: (args: RunArgs) => void;
  onSelect: (ad: Ad) => void;
}) {
  const [mode, setMode] = useState<"url" | "page_id" | "keyword">("url");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("ALL");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<"meta" | "newest" | "longest">("meta");

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of ads) if (a.mediaType) c[a.mediaType] = (c[a.mediaType] ?? 0) + 1;
    return c;
  }, [ads]);

  const filtered = useMemo(() => {
    let out = ads;
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((a) =>
        [a.creativeAngle, a.headlineTitle, a.displayPrimaryText, a.adDescription]
          .some((f) => f?.toLowerCase().includes(q))
      );
    }
    if (typeFilter.size) out = out.filter((a) => a.mediaType && typeFilter.has(a.mediaType));
    const arr = [...out];
    if (sort === "newest") arr.sort((a, b) => new Date(b.adStartDate ?? 0).getTime() - new Date(a.adStartDate ?? 0).getTime());
    else if (sort === "longest")
      arr.sort((a, b) => (longevityBadge(b.snapshotDate, b.adStartDate)?.days ?? -1) - (longevityBadge(a.snapshotDate, a.adStartDate)?.days ?? -1));
    else
      arr.sort((a, b) => {
        const r = (a.metaSortRank ?? 999) - (b.metaSortRank ?? 999);
        if (r !== 0) return r;
        // deterministic tie-break: latest snapshot first (rank is only per-run)
        return new Date(b.snapshotDate ?? b.adStartDate ?? 0).getTime() - new Date(a.snapshotDate ?? a.adStartDate ?? 0).getTime();
      });
    return arr;
  }, [ads, search, typeFilter, sort]);

  const toggleType = (t: string) =>
    setTypeFilter((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  return (
    <div className="space-y-5">
      {/* Quick scrape */}
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
              onKeyDown={(e) => e.key === "Enter" && onRunScrape({ mode, query, country, count })}
            />
          </div>
          {mode !== "url" && (
            <div className="w-24 space-y-1.5">
              <Label>Country</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="ALL" />
            </div>
          )}
          <div className="w-28 space-y-1.5">
            <Label>Ads to scrape</Label>
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm"
            >
              {AD_COUNTS.map((n) => (
                <option key={n} value={n}>{n} ads</option>
              ))}
            </select>
          </div>
          <Button onClick={() => onRunScrape({ mode, query, country, count })} disabled={running || !query.trim()}>
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run scrape
          </Button>
        </div>
        {activeJob && (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {activeJob.status} — “{activeJob.query}”{activeJob.stats?.adsFound ? ` · ${activeJob.stats.adsFound} ads` : ""}
          </p>
        )}
      </BentoCard>

      {/* Filter bar */}
      {ads.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search angles, headlines, copy…" className="pl-9" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MEDIA_TYPES.filter((t) => counts[t]).map((t) => (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  typeFilter.has(t) ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {MEDIA_ICON[t]} {mediaLabel(t)} ({counts[t]})
              </button>
            ))}
            {typeFilter.size > 0 && (
              <button onClick={() => setTypeFilter(new Set())} className="px-2 text-xs text-muted-foreground underline hover:text-foreground">
                Clear
              </button>
            )}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="h-9 rounded-xl border border-input bg-background/60 px-3 text-sm"
          >
            <option value="meta">Meta default</option>
            <option value="newest">Newest first</option>
            <option value="longest">Longest running</option>
          </select>
          <span className="text-xs text-muted-foreground">{filtered.length} of {ads.length}</span>
        </div>
      )}

      {/* Grid */}
      {loading && ads.length === 0 ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[4/3] animate-pulse rounded-[var(--radius)] bg-muted/50" />
          ))}
        </div>
      ) : ads.length === 0 ? (
        <EmptyState
          icon={Radar}
          title="No competitor ads yet"
          description="Paste a competitor's Meta Ad Library URL above (or add them under Competitors) and run a scrape to pull their live ads."
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          No ads match your filters. <button onClick={() => { setSearch(""); setTypeFilter(new Set()); }} className="underline">Clear filters</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map((ad) => (
            <AdCard key={ad.id} ad={ad} onClick={() => onSelect(ad)} />
          ))}
        </div>
      )}
    </div>
  );
}

function AdCard({ ad, onClick }: { ad: Ad; onClick: () => void }) {
  const badge = longevityBadge(ad.snapshotDate, ad.adStartDate);
  const title = ad.creativeAngle || ad.headlineTitle || "Untitled ad";
  const [thumb, setThumb] = useState(ad.thumbUrl);
  const [reSigned, setReSigned] = useState(false);
  const mediaMissing = !!ad.mediaType && ad.mediaType !== "text" && !thumb;

  const onThumbError = async () => {
    if (reSigned) return setThumb(null);
    setReSigned(true);
    try {
      const r = await fetch(`/api/systems/competitor-research/ad/${ad.id}/media`);
      if (r.ok) {
        const fresh = await r.json();
        setThumb(fresh.thumbUrl ?? null);
        return;
      }
    } catch {
      /* ignore */
    }
    setThumb(null);
  };

  return (
    <button onClick={onClick} className="group text-left">
      <BentoCard interactive className="flex h-full flex-col overflow-hidden p-0">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" onError={onThumbError} />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">{MEDIA_ICON[ad.mediaType ?? "image"] ?? <ImageIcon className="size-6" />}</div>
          )}
          {ad.mediaType === "video" && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
                <Play className="size-4" />
              </span>
            </span>
          )}
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {MEDIA_ICON[ad.mediaType ?? ""]} {mediaLabel(ad.mediaType)}
          </span>
          <span className="absolute right-2 top-2 flex gap-1">
            {badge && <Badge variant={badge.variant} className="bg-card/85 backdrop-blur">{badge.label}</Badge>}
            {ad.dedupCount > 1 && <Badge variant="muted" className="bg-card/85 backdrop-blur">×{ad.dedupCount}</Badge>}
          </span>
          {ad.aiAnalysisStatus !== "complete" && (
            <span className="absolute bottom-2 left-2">
              <Badge variant={ad.aiAnalysisStatus === "failed" ? "warning" : "soon"} className="bg-card/85 backdrop-blur">
                {ad.aiAnalysisStatus === "failed" ? "analysis failed" : "analyzing…"}
              </Badge>
            </span>
          )}
          {mediaMissing && (
            <span className="absolute bottom-2 right-2">
              <Badge variant="muted" className="bg-card/85 backdrop-blur">media unavailable</Badge>
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3">
          <h3 className="line-clamp-2 text-sm font-medium leading-tight">{title}</h3>
          <p className="text-xs text-muted-foreground">{ad.brandPageName ?? "Unknown advertiser"}</p>
          {ad.platformsDisplay && <p className="text-[10px] text-muted-foreground/70">{ad.platformsDisplay}</p>}
        </div>
      </BentoCard>
    </button>
  );
}
