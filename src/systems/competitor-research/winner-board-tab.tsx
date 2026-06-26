"use client";

import { useMemo, useState } from "react";
import {
  Play,
  Image as ImageIcon,
  Layout,
  FileText,
  Search,
  Trophy,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  TrendingUp,
  Flame,
  Layers,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import type { Concept } from "./ui-types";
import { tierMeta, titleCase, CONFIDENCE_DOT, mediaLabel, TIER_META } from "./ui-utils";
import { RemakeButton } from "./remake-button";

const MEDIA_ICON: Record<string, React.ReactNode> = {
  video: <Play className="size-3" />,
  image: <ImageIcon className="size-3" />,
  carousel: <Layout className="size-3" />,
  text: <FileText className="size-3" />,
};

type Sort = "score" | "variants" | "recency";

export function WinnerBoardTab({
  brandId,
  concepts,
  momentum,
  loading,
  hasActiveJob,
  onViewVariants,
  onSaveSwipe,
  savedConceptIds,
}: {
  brandId: string;
  concepts: Concept[];
  momentum: Concept[];
  loading: boolean;
  hasActiveJob: boolean;
  onViewVariants: (c: Concept) => void;
  onSaveSwipe: (conceptId: string) => void;
  savedConceptIds: Set<string>;
}) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<Set<string>>(new Set());
  const [formatFilter, setFormatFilter] = useState<Set<string>>(new Set());
  const [driverFilter, setDriverFilter] = useState<Set<string>>(new Set());
  const [awarenessFilter, setAwarenessFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<Sort>("score");

  const formatCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const k of concepts) for (const f of k.formats) c[f] = (c[f] ?? 0) + 1;
    return c;
  }, [concepts]);

  const tierCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const k of concepts) if (k.tier) c[k.tier] = (c[k.tier] ?? 0) + 1;
    return c;
  }, [concepts]);

  const driverCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const k of concepts) { const d = k.angleBank?.emotionalDriver; if (d) c[d] = (c[d] ?? 0) + 1; }
    return c;
  }, [concepts]);

  const awarenessCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const k of concepts) { const a = k.angleBank?.awarenessLevel; if (a) c[a] = (c[a] ?? 0) + 1; }
    return c;
  }, [concepts]);

  const filtered = useMemo(() => {
    let out = concepts;
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((c) =>
        [c.title, c.advertiser, c.angleBank?.angle, c.angleBank?.hook, c.angleBank?.mechanism].some((f) => f?.toLowerCase().includes(q))
      );
    }
    if (tierFilter.size) out = out.filter((c) => c.tier && tierFilter.has(c.tier));
    if (formatFilter.size) out = out.filter((c) => c.formats.some((f) => formatFilter.has(f)));
    if (driverFilter.size) out = out.filter((c) => c.angleBank?.emotionalDriver && driverFilter.has(c.angleBank.emotionalDriver));
    if (awarenessFilter.size) out = out.filter((c) => c.angleBank?.awarenessLevel && awarenessFilter.has(c.angleBank.awarenessLevel));
    const arr = [...out];
    if (sort === "variants") arr.sort((a, b) => b.activeVariantCount - a.activeVariantCount);
    else if (sort === "recency") arr.sort((a, b) => b.activeDays - a.activeDays);
    else arr.sort((a, b) => b.winnerScore - a.winnerScore);
    return arr;
  }, [concepts, search, tierFilter, formatFilter, driverFilter, awarenessFilter, sort]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    setter(next);
  };

  if (loading && concepts.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-[4/3] animate-pulse rounded-[var(--radius)] bg-muted/50" />
        ))}
      </div>
    );
  }

  if (concepts.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title={hasActiveJob ? "Scoring competitor ads…" : "No scored concepts yet"}
        description={
          hasActiveJob
            ? "Ads are being scraped, analyzed and clustered into scored concepts. Winners appear here as they're ranked."
            : "Run a scrape (Ad Library or Competitors tab). Each competitor's ads get clustered into concepts and ranked by a composite winner score."
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Momentum row */}
      {momentum.length > 0 && (
        <div className="space-y-2.5">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Flame className="size-4 text-warning" /> New &amp; scaling this week
          </h3>
          <div className="stagger flex gap-3 overflow-x-auto pb-1">
            {momentum.map((c) => (
              <button
                key={c.id}
                onClick={() => onViewVariants(c)}
                className="group w-56 shrink-0 text-left"
              >
                <BentoCard interactive className="flex h-full flex-col overflow-hidden p-0">
                  <ConceptThumb c={c} className="aspect-video" />
                  <div className="flex flex-1 flex-col gap-1 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <ScoreBadge c={c} />
                      {c.momentum.wowDelta > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-warning">
                          <TrendingUp className="size-3" /> +{c.momentum.wowDelta}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-xs font-medium leading-tight">{c.title}</p>
                    <p className="text-[11px] text-muted-foreground">{c.advertiser ?? "Unknown"}</p>
                  </div>
                </BentoCard>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filter / sort bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search angles, hooks, advertisers…" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(TIER_META)
            .filter((t) => tierCounts[t])
            .map((t) => {
              const m = TIER_META[t];
              return (
                <button
                  key={t}
                  onClick={() => toggle(tierFilter, setTierFilter, t)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    tierFilter.has(t) ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  <span>{m.emoji}</span> {m.label} ({tierCounts[t]})
                </button>
              );
            })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(formatCounts).map((f) => (
            <button
              key={f}
              onClick={() => toggle(formatFilter, setFormatFilter, f)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                formatFilter.has(f) ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {MEDIA_ICON[f]} {mediaLabel(f)} ({formatCounts[f]})
            </button>
          ))}
        </div>
        {Object.keys(driverCounts).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(driverCounts).map((d) => (
              <button key={d} onClick={() => toggle(driverFilter, setDriverFilter, d)}
                className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors", driverFilter.has(d) ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground hover:bg-muted")}>
                {titleCase(d)} ({driverCounts[d]})
              </button>
            ))}
          </div>
        )}
        {Object.keys(awarenessCounts).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(awarenessCounts).map((a) => (
              <button key={a} onClick={() => toggle(awarenessFilter, setAwarenessFilter, a)}
                className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors", awarenessFilter.has(a) ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground hover:bg-muted")}>
                {titleCase(a)}-aware ({awarenessCounts[a]})
              </button>
            ))}
          </div>
        )}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="h-9 rounded-xl border border-input bg-background/60 px-3 text-sm"
        >
          <option value="score">Top score</option>
          <option value="variants">Most variants</option>
          <option value="recency">Longest active</option>
        </select>
        <span className="text-xs text-muted-foreground">{filtered.length} of {concepts.length}</span>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          No concepts match your filters.{" "}
          <button
            onClick={() => {
              setSearch("");
              setTierFilter(new Set());
              setFormatFilter(new Set());
              setDriverFilter(new Set());
              setAwarenessFilter(new Set());
            }}
            className="underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((c) => (
            <WinnerCard
              key={c.id}
              c={c}
              brandId={brandId}
              saved={savedConceptIds.has(c.id)}
              onViewVariants={() => onViewVariants(c)}
              onSaveSwipe={() => onSaveSwipe(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConceptThumb({ c, className }: { c: Concept; className?: string }) {
  const [thumb, setThumb] = useState(c.thumbUrl);
  return (
    <div className={cn("relative w-full overflow-hidden bg-muted", className ?? "aspect-[4/3]")}>
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
          onError={() => setThumb(null)}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          {MEDIA_ICON[c.mediaType ?? "image"] ?? <ImageIcon className="size-6" />}
        </div>
      )}
      {c.mediaType === "video" && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Play className="size-4" />
          </span>
        </span>
      )}
      {tierMeta(c.tier) && (
        <span className="absolute left-2 top-2">
          <Badge variant={tierMeta(c.tier)!.variant} className="gap-1 bg-card/85 backdrop-blur">
            <span>{tierMeta(c.tier)!.emoji}</span> {tierMeta(c.tier)!.label}
          </Badge>
        </span>
      )}
    </div>
  );
}

function ScoreBadge({ c }: { c: Concept }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-card/85 px-2 py-0.5 text-xs font-semibold backdrop-blur">
      <span className={cn("size-1.5 rounded-full", CONFIDENCE_DOT[c.confidence] ?? "bg-muted-foreground/40")} />
      {c.winnerScore}
    </span>
  );
}

function WinnerCard({
  c,
  brandId,
  saved,
  onViewVariants,
  onSaveSwipe,
}: {
  c: Concept;
  brandId: string;
  saved: boolean;
  onViewVariants: () => void;
  onSaveSwipe: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ab = c.angleBank;

  return (
    <BentoCard interactive className="group flex h-full flex-col overflow-hidden p-0">
      <button onClick={onViewVariants} className="text-left">
        <div className="relative">
          <ConceptThumb c={c} />
          <span className="absolute right-2 top-2">
            <ScoreBadge c={c} />
          </span>
        </div>
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <h3 className="line-clamp-2 text-sm font-medium leading-tight">{c.title}</h3>
          <p className="text-xs text-muted-foreground">{c.advertiser ?? "Unknown advertiser"}</p>
        </div>

        {/* signal chips */}
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <Chip icon={<Layers className="size-3" />} label={`×${c.activeVariantCount} live`} />
          <Chip icon={<CalendarDays className="size-3" />} label={`${c.activeDays}d active`} />
          {c.momentum.wowDelta > 0 && <Chip icon={<TrendingUp className="size-3" />} label={`+${c.momentum.wowDelta} wk`} tone="warning" />}
          {ab?.emotionalDriver && <Chip label={titleCase(ab.emotionalDriver)} tone="accent" />}
          {ab?.awarenessLevel && <Chip label={titleCase(ab.awarenessLevel)} />}
        </div>

        {/* teardown */}
        {ab && (
          <div className="mt-0.5">
            <button
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              Teardown <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            </button>
            {open && (
              <div className="mt-2 space-y-1.5 rounded-xl bg-muted/40 p-2.5 text-xs">
                <TD label="Angle" value={ab.angle} />
                <TD label="Hook" value={ab.hook} />
                <TD label="Mechanism" value={ab.mechanism} />
                {ab.offer && <TD label="Offer" value={ab.offer} />}
                {ab.beatStructure.length > 0 && (
                  <div>
                    <p className="font-medium text-muted-foreground">Beats:</p>
                    <ol className="mt-0.5 space-y-0.5">
                      {ab.beatStructure.map((b, i) => (
                        <li key={i} className="text-foreground/85">
                          <span className="font-semibold uppercase tracking-wide text-muted-foreground">{b.beat}:</span> {b.text}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {ab.complianceFlags.length > 0 && (
                  <p className="text-warning">⚠ {ab.complianceFlags.join(" · ")}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* footer actions */}
        <div className="mt-auto flex items-center gap-1.5 border-t border-border/60 pt-2.5">
          <RemakeButton concept={c} brandId={brandId} />
          <Button size="sm" variant={saved ? "outline" : "ghost"} onClick={onSaveSwipe} disabled={saved} aria-label={saved ? "Saved to swipe" : "Save to swipe"}>
            {saved ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={onViewVariants} className="ml-auto">
            Variants
          </Button>
        </div>
      </div>
    </BentoCard>
  );
}

function Chip({ icon, label, tone }: { icon?: React.ReactNode; label: string; tone?: "warning" | "accent" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium",
        tone === "warning"
          ? "border-warning/30 bg-warning/10 text-warning"
          : tone === "accent"
            ? "border-accent/30 bg-accent/10 text-accent"
            : "border-border bg-muted/50 text-muted-foreground"
      )}
    >
      {icon} {label}
    </span>
  );
}

function TD({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <p className="text-foreground/85">
      <span className="font-medium text-muted-foreground">{label}: </span>
      {value}
    </p>
  );
}
