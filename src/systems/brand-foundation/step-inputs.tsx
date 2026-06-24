"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, ArrowRight, Save } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { BrandSource } from "./ui-types";

const REVIEW_SITES = [
  { value: "amazon", label: "Amazon" },
  { value: "trustpilot", label: "Trustpilot" },
  { value: "google_reviews", label: "Google" },
];

type CompRow = { name: string; website: string; metaLibraryUrl: string };
type RevRow = { site: string; url: string };

export function StepInputs({ brandId, sources, onSaved, onContinue }: { brandId: string; sources: BrandSource[]; onSaved: () => void; onContinue: () => void }) {
  const find = (type: string) => sources.find((s) => s.type === type);
  const [website, setWebsite] = useState(find("website")?.url ?? "");
  const [metaUrl, setMetaUrl] = useState(find("meta_ads")?.url ?? "");
  const [competitors, setCompetitors] = useState<CompRow[]>(
    sources.filter((s) => s.type === "competitor").map((s) => ({ name: String(s.config?.name ?? ""), website: s.url ?? "", metaLibraryUrl: String(s.config?.metaLibraryUrl ?? "") }))
  );
  const [reviews, setReviews] = useState<RevRow[]>(
    sources.filter((s) => ["amazon", "trustpilot", "google_reviews"].includes(s.type)).map((s) => ({ site: s.type, url: s.url ?? "" }))
  );
  const [saving, setSaving] = useState(false);

  const build = () => {
    const out: { type: string; url?: string; handle?: string; config?: Record<string, unknown> }[] = [];
    if (website.trim()) out.push({ type: "website", url: website.trim() });
    if (metaUrl.trim()) out.push({ type: "meta_ads", url: metaUrl.trim() });
    competitors.filter((c) => c.name.trim() || c.website.trim()).forEach((c) =>
      out.push({ type: "competitor", url: c.website.trim() || undefined, handle: c.name.trim() || undefined, config: { name: c.name.trim(), metaLibraryUrl: c.metaLibraryUrl.trim() } })
    );
    reviews.filter((r) => r.url.trim()).forEach((r) => out.push({ type: r.site, url: r.url.trim() }));
    return out;
  };

  const save = async (then?: () => void) => {
    setSaving(true);
    const res = await fetch("/api/brand-foundation/sources", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, sources: build() }),
    });
    setSaving(false);
    if (res.ok) { toast.success("Inputs saved"); onSaved(); then?.(); }
    else toast.error(((await res.json().catch(() => ({}))) as { error?: string })?.error ?? "Couldn't save");
  };

  return (
    <div className="space-y-4">
      <BentoCard className="space-y-3 p-5">
        <h3 className="font-display text-base font-medium">Brand &amp; ads</h3>
        <div className="space-y-1.5">
          <Label>Website URL</Label>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://brand.com" />
        </div>
        <div className="space-y-1.5">
          <Label>Meta Ad Library page (URL)</Label>
          <Input value={metaUrl} onChange={(e) => setMetaUrl(e.target.value)} placeholder="https://www.facebook.com/ads/library/?…view_all_page_id=…" />
        </div>
      </BentoCard>

      <BentoCard className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-medium">Competitors</h3>
          <Button size="sm" variant="outline" onClick={() => setCompetitors((p) => [...p, { name: "", website: "", metaLibraryUrl: "" }])}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
        {competitors.length === 0 && <p className="text-xs text-muted-foreground">Optional — add direct competitors to research.</p>}
        {competitors.map((c, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Input value={c.name} onChange={(e) => setCompetitors((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" />
            <Input value={c.website} onChange={(e) => setCompetitors((p) => p.map((x, j) => (j === i ? { ...x, website: e.target.value } : x)))} placeholder="Website" />
            <Input value={c.metaLibraryUrl} onChange={(e) => setCompetitors((p) => p.map((x, j) => (j === i ? { ...x, metaLibraryUrl: e.target.value } : x)))} placeholder="Meta Ad Library URL" />
            <Button size="iconSm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setCompetitors((p) => p.filter((_, j) => j !== i))} aria-label="Remove">
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </BentoCard>

      <BentoCard className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-medium">Review sources</h3>
          <Button size="sm" variant="outline" onClick={() => setReviews((p) => [...p, { site: "amazon", url: "" }])}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
        {reviews.length === 0 && <p className="text-xs text-muted-foreground">Optional — paste an Amazon product, Trustpilot company, or Google Maps page URL. We scrape real reviews for verbatim voice-of-customer.</p>}
        {reviews.map((r, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr_auto]">
            <select value={r.site} onChange={(e) => setReviews((p) => p.map((x, j) => (j === i ? { ...x, site: e.target.value } : x)))} className="h-10 rounded-xl border border-input bg-background/60 px-3 text-sm">
              {REVIEW_SITES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <Input value={r.url} onChange={(e) => setReviews((p) => p.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="Reviews page URL" />
            <Button size="iconSm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setReviews((p) => p.filter((_, j) => j !== i))} aria-label="Remove">
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </BentoCard>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={() => save()} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save inputs
        </Button>
        <Button className="cta-glow" onClick={() => save(onContinue)} disabled={saving}>
          Save &amp; run research <ArrowRight className="size-4" />
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">Every source is researched automatically — website crawl, Meta/competitor ads, real review scrapes for VOC, and a compliance check — then a draft B3 is synthesized for your review.</p>
    </div>
  );
}
