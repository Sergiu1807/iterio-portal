"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Play, Trash2, ExternalLink, Building2 } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input, Label } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import type { Source } from "./ui-types";
import { COUNTRIES, timeAgo, AD_COUNTS } from "./ui-utils";

export function CompetitorsTab({
  brandId,
  sources,
  reload,
  onRefresh,
  count,
  setCount,
}: {
  brandId: string;
  sources: Source[];
  reload: () => void;
  onRefresh: (source: Source) => void;
  count: number;
  setCount: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [country, setCountry] = useState("ALL");
  const [saving, setSaving] = useState(false);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Add competitors by their Meta Ad Library link, then Refresh to pull their live ads.</p>
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
