"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Check, AlertTriangle, Globe, Megaphone, Building2, Star, FileSearch, Sparkles, ArrowRight } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { BrandSource } from "./ui-types";
import { SOURCE_TYPE_LABEL } from "./ui-utils";

type Job = { id: string; sourceId: string | null; module: string; status: string; costCents: number; error: string | null };

const ICON: Record<string, React.ReactNode> = {
  website: <Globe className="size-4" />, meta_ads: <Megaphone className="size-4" />, competitor: <Building2 className="size-4" />,
  amazon: <Star className="size-4" />, trustpilot: <Star className="size-4" />, google_reviews: <Star className="size-4" />,
};
const STATUS: Record<string, { label: string; variant: "muted" | "warning" | "success" | "outline"; spin?: boolean }> = {
  idle: { label: "Idle", variant: "muted" }, queued: { label: "Queued", variant: "muted" },
  running: { label: "Researching…", variant: "warning", spin: true }, complete: { label: "Complete", variant: "success" },
  failed: { label: "Failed", variant: "outline" }, partial: { label: "Later build", variant: "muted" },
};

export function StepResearch({
  brandId, sources, jobs, hasDraft, onRerun, onSynthesize, onReview,
}: {
  brandId: string; sources: BrandSource[]; jobs: Job[]; hasDraft: boolean;
  onRerun: (sourceId: string) => void; onSynthesize: () => void; onReview: () => void;
}) {
  const [viewer, setViewer] = useState<BrandSource | null>(null);
  const jobBySource = new Map(jobs.filter((j) => j.sourceId).map((j) => [j.sourceId as string, j]));
  const live = sources.filter((s) => ["website", "meta_ads", "competitor"].includes(s.type));
  const settled = live.every((s) => ["complete", "failed", "partial"].includes(s.status));
  const anyComplete = live.some((s) => s.status === "complete");
  const totalCost = jobs.reduce((a, j) => a + (j.costCents ?? 0), 0);

  if (sources.length === 0) {
    return <BentoCard className="p-6 text-center text-sm text-muted-foreground">No sources yet — add some in the Inputs step.</BentoCard>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sources.map((s) => {
          const st = STATUS[s.status] ?? STATUS.idle;
          const job = jobBySource.get(s.id);
          const label = s.type === "competitor" ? String(s.config?.name ?? s.handle ?? "Competitor") : SOURCE_TYPE_LABEL[s.type] ?? s.type;
          return (
            <BentoCard key={s.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">{ICON[s.type] ?? <FileSearch className="size-4" />}</span>
                  {label}
                </span>
                <Badge variant={st.variant} className="gap-1">{st.spin && <Loader2 className="size-3 animate-spin" />}{st.label}</Badge>
              </div>
              {s.url && <p className="truncate text-xs text-muted-foreground">{s.url}</p>}
              {s.lastError && <p className="text-xs text-warning">{s.lastError}</p>}
              <div className="mt-auto flex items-center justify-between pt-1 text-xs text-muted-foreground">
                <span>{job?.costCents ? `$${(job.costCents / 100).toFixed(3)}` : "—"}</span>
                <div className="flex gap-1">
                  {s.status === "complete" && <Button size="sm" variant="ghost" onClick={() => setViewer(s)}>View</Button>}
                  {["website", "meta_ads", "competitor"].includes(s.type) && (
                    <Button size="sm" variant="ghost" onClick={() => onRerun(s.id)} aria-label="Re-run"><RefreshCw className="size-3.5" /></Button>
                  )}
                </div>
              </div>
            </BentoCard>
          );
        })}
      </div>

      <BentoCard className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-sm">
          {settled ? (
            <span className="flex items-center gap-1.5 text-success"><Check className="size-4" /> Research settled · ${(totalCost / 100).toFixed(3)}</span>
          ) : anyComplete ? (
            <span className="flex items-center gap-1.5 text-muted-foreground"><AlertTriangle className="size-4 text-warning" /> Some sources still running — you can draft now and the rest fill in.</span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Researching your sources…</span>
          )}
        </div>
        <div className="flex gap-2">
          {anyComplete && <Button variant="outline" onClick={onSynthesize}><Sparkles className="size-4" /> Synthesize B3 now</Button>}
          {hasDraft && <Button className="cta-glow" onClick={onReview}>Review B3 <ArrowRight className="size-4" /></Button>}
        </div>
      </BentoCard>

      <ExtractionViewer source={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}

function ExtractionViewer({ source, onClose }: { source: BrandSource | null; onClose: () => void }) {
  const [data, setData] = useState<{ raw: unknown; structured: { json: unknown } | null } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!source) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/brand-foundation/sources/${source.id}/extraction`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source]);

  const raw = (data?.raw ?? null) as { text?: string; tavilyAnswer?: string; note?: string } | null;
  return (
    <Dialog open={!!source} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <div className="max-h-[80vh] space-y-3 overflow-y-auto">
          <h2 className="font-display text-lg font-medium">{source ? (SOURCE_TYPE_LABEL[source.type] ?? source.type) : ""} extraction</h2>
          {loading || !data ? (
            <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <Tabs defaultValue="structured">
              <TabsList>
                <TabsTrigger value="structured">Structured</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>
              <TabsContent value="structured">
                <pre className="whitespace-pre-wrap rounded-xl bg-muted/50 p-3 text-xs">{data.structured ? JSON.stringify(data.structured.json, null, 2) : "No structured extraction (scraped via Competitor Research)."}</pre>
              </TabsContent>
              <TabsContent value="raw">
                {!raw ? (
                  <p className="text-sm text-muted-foreground">No raw artifact.</p>
                ) : raw.note ? (
                  <p className="text-sm text-muted-foreground">{raw.note}</p>
                ) : (
                  <div className="space-y-3 text-sm">
                    {raw.tavilyAnswer && <div><p className="font-medium">Web research</p><p className="whitespace-pre-wrap text-foreground/85">{raw.tavilyAnswer}</p></div>}
                    {raw.text && <div><p className="font-medium">Page text</p><p className="whitespace-pre-wrap text-foreground/80">{raw.text.slice(0, 6000)}</p></div>}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
