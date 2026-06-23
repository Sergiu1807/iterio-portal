"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Play, Trash2, ExternalLink, Building2, Sparkles, Loader2, Radar, CheckSquare, Square } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input, Label } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import type { Source } from "./ui-types";
import { COUNTRIES, timeAgo, AD_COUNTS } from "./ui-utils";

type Candidate = { name: string; domain?: string; metaPageUrl?: string; hasMetaUrl: boolean };

export function CompetitorsTab({
  brandId,
  sources,
  reload,
  onRefresh,
  onDiscovered,
  count,
  setCount,
}: {
  brandId: string;
  sources: Source[];
  reload: () => void;
  onRefresh: (source: Source) => void;
  onDiscovered: () => void;
  count: number;
  setCount: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [country, setCountry] = useState("ALL");
  const [saving, setSaving] = useState(false);

  const [discInput, setDiscInput] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [niche, setNiche] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  // picks aligned to candidates: which to scrape + per-competitor ad count
  const [picks, setPicks] = useState<{ selected: boolean; count: number }[]>([]);

  const selectedCount = picks.filter((p) => p.selected).length;

  // Phase 1 — discover candidates (no scraping)
  const discover = async () => {
    if (!discInput.trim()) return;
    setDiscovering(true);
    setCandidates(null);
    const res = await fetch("/api/systems/competitor-research/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, input: discInput.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setDiscovering(false);
    if (res.ok) {
      const cands: Candidate[] = data.candidates ?? [];
      setNiche(data.niche ?? "");
      setCandidates(cands);
      setPicks(cands.map(() => ({ selected: true, count: 20 })));
      if (!cands.length) toast.message("No competitors found — try a more specific brand, or add one manually.");
    } else {
      toast.error(data?.error ?? "Discovery failed");
    }
  };

  // Phase 2 — scrape (and save) the chosen competitors
  const scrapeSelected = async () => {
    if (!candidates) return;
    const selected = candidates
      .map((c, i) => ({ cand: c, pick: picks[i] }))
      .filter((x) => x.pick?.selected)
      .map((x) => ({ name: x.cand.name, domain: x.cand.domain, metaPageUrl: x.cand.metaPageUrl, count: x.pick.count }));
    if (!selected.length) return;
    setScraping(true);
    const res = await fetch("/api/systems/competitor-research/discover/scrape", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, niche, selected }),
    });
    const data = await res.json().catch(() => ({}));
    setScraping(false);
    if (res.ok) {
      toast.success(`Scraping ${data.jobsStarted} competitor${data.jobsStarted === 1 ? "" : "s"}`, {
        description: "Saved to your competitors list — the Winner Board fills in as their ads are analyzed.",
      });
      setCandidates(null);
      setDiscInput("");
      onDiscovered();
    } else {
      toast.error(data?.error ?? "Couldn't start scrapes");
    }
  };

  const setPick = (i: number, patch: Partial<{ selected: boolean; count: number }>) =>
    setPicks((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const add = async () => {
    if (!name.trim() || !url.trim()) return;
    setSaving(true);
    const res = await fetch("/api/systems/competitor-research/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, name, metaLibraryUrl: url, country }),
    });
    setSaving(false);
    if (res.ok) {
      setName(""); setUrl(""); setCountry("ALL"); setOpen(false);
      reload();
    } else {
      toast.error((await res.json().catch(() => ({})))?.error ?? "Couldn't add competitor");
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch("/api/systems/competitor-research/sources", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    reload();
  };
  const remove = async (id: string) => {
    await fetch("/api/systems/competitor-research/sources", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    reload();
  };

  return (
    <div className="space-y-4">
      {/* Auto-discovery: one brand → its competitor set */}
      <BentoCard className="space-y-3 p-5 brand-wash">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary/12 text-primary">
            <Radar className="size-4" />
          </span>
          <div>
            <h3 className="font-medium leading-tight">Discover competitors</h3>
            <p className="text-xs text-muted-foreground">One brand → its niche + top competitors, harvested automatically.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1 space-y-1.5">
            <Label>Brand name, domain, or Meta Page URL</Label>
            <Input
              value={discInput}
              onChange={(e) => setDiscInput(e.target.value)}
              placeholder="e.g. Vital Proteins  ·  vitalproteins.com"
              disabled={discovering}
              onKeyDown={(e) => e.key === "Enter" && !discovering && discover()}
            />
          </div>
          <Button className="cta-glow" onClick={discover} disabled={discovering || !discInput.trim()}>
            {discovering ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Discover competitors
          </Button>
        </div>
        {discovering && (
          <div className="shimmer flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Researching the niche → finding competitors…
          </div>
        )}

        {candidates && candidates.length > 0 && (
          <div className="space-y-2.5 border-t border-border/60 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {candidates.length} competitor{candidates.length === 1 ? "" : "s"} found
                {niche && <span className="font-normal text-muted-foreground"> · {niche}</span>}
              </p>
              <div className="flex items-center gap-2 text-xs">
                <button onClick={() => setPicks((p) => p.map((x) => ({ ...x, selected: true })))} className="text-muted-foreground underline hover:text-foreground">
                  Select all
                </button>
                <button onClick={() => setPicks((p) => p.map((x) => ({ ...x, selected: false })))} className="text-muted-foreground underline hover:text-foreground">
                  None
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {candidates.map((c, i) => {
                const on = picks[i]?.selected;
                return (
                  <div
                    key={c.name + i}
                    className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${on ? "border-primary/40 bg-primary/5" : "border-border bg-card/40"}`}
                  >
                    <button onClick={() => setPick(i, { selected: !on })} className="shrink-0 text-primary" aria-label={on ? "Deselect" : "Select"}>
                      {on ? <CheckSquare className="size-5" /> : <Square className="size-5 text-muted-foreground" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{c.name}</span>
                        <Badge variant={c.hasMetaUrl ? "accent" : "muted"}>{c.hasMetaUrl ? "Meta page" : "keyword"}</Badge>
                      </div>
                      {c.domain && (
                        <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                          {c.domain} <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Ads
                      <select
                        value={picks[i]?.count ?? 20}
                        onChange={(e) => setPick(i, { count: Number(e.target.value) })}
                        disabled={!on}
                        className="h-8 rounded-lg border border-input bg-background/60 px-2 text-sm disabled:opacity-40"
                      >
                        {AD_COUNTS.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {selectedCount} selected · {picks.reduce((s, p) => s + (p.selected ? p.count : 0), 0)} ads total
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setCandidates(null)} disabled={scraping}>Cancel</Button>
                <Button className="cta-glow" onClick={scrapeSelected} disabled={scraping || selectedCount === 0}>
                  {scraping ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Scrape {selectedCount} selected
                </Button>
              </div>
            </div>
          </div>
        )}
      </BentoCard>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">…or add competitors by hand via their Meta Ad Library link, then Refresh to pull their live ads.</p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Ads/scrape
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="h-9 rounded-xl border border-input bg-background/60 px-2.5 text-sm"
            >
              {AD_COUNTS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
            <Plus className="size-4" /> Add competitor
          </Button>
        </div>
      </div>

      {open && (
        <BentoCard className="space-y-3 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr_auto]">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vital Proteins" />
            </div>
            <div className="space-y-1.5">
              <Label>Meta Ad Library link</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.facebook.com/ads/library/?…view_all_page_id=…" />
            </div>
            <div className="space-y-1.5">
              <Label>Country</Label>
              <select value={country} onChange={(e) => setCountry(e.target.value)} className="h-10 rounded-xl border border-input bg-background/60 px-3 text-sm">
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={add} disabled={saving || !name.trim() || !url.trim()}>Save</Button>
          </div>
        </BentoCard>
      )}

      {sources.length === 0 ? (
        <EmptyState icon={Building2} title="No competitors yet" description="Add a competitor with their Meta Ad Library link to start tracking their ads." />
      ) : (
        <div className="space-y-2.5">
          {sources.map((s) => (
            <BentoCard key={s.id} className={`flex flex-wrap items-center gap-3 p-4 ${!s.isActive ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{s.name}</h3>
                  {s.country && s.country !== "ALL" && <Badge variant="muted">{s.country}</Badge>}
                  {s.type && <Badge variant="outline">{s.type}</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {s.metaLibraryUrl && (
                    <a href={s.metaLibraryUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                      Ad Library <ExternalLink className="size-3" />
                    </a>
                  )}
                  <span>Last scraped: {timeAgo(s.lastScrapedAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <Button size="sm" variant="outline" disabled={!s.metaLibraryUrl || !s.isActive} onClick={() => onRefresh(s)}>
                  <Play className="size-3.5" /> Refresh
                </Button>
                <Switch checked={s.isActive} onCheckedChange={(v) => patch(s.id, { isActive: v })} aria-label="Active" />
                <Button size="iconSm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => remove(s.id)} aria-label="Remove">
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </BentoCard>
          ))}
        </div>
      )}
    </div>
  );
}
