"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check, RefreshCw, Trash2, Film, LayoutGrid, ShieldAlert, ShieldCheck, ShieldX, Send, PenSquare, AlertTriangle } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Brief } from "./ui-types";
import type { VideoBriefJson, StaticBriefJson } from "./types";
import { sendBriefToProduction } from "./production-bridge";

const COMPLIANCE: Record<string, { variant: NonNullable<BadgeProps["variant"]>; icon: React.ReactNode; label: string }> = {
  safe: { variant: "success", icon: <ShieldCheck className="size-3" />, label: "compliant" },
  risky: { variant: "warning", icon: <ShieldAlert className="size-3" />, label: "risky" },
  banned: { variant: "outline", icon: <ShieldX className="size-3" />, label: "banned" },
};

export function BriefView({ brandId, brief, reload }: { brandId: string; brief: Brief; reload: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const isVideo = brief.format === "video";
  const comp = COMPLIANCE[brief.complianceNotesJson?.flag ?? "safe"] ?? COMPLIANCE.safe;

  const act = async (body: Record<string, unknown>, msg?: string) => {
    setBusy(true);
    const r = await fetch(`/api/systems/brief-generation/briefs/${brief.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { if (msg) toast.success(msg); reload(); } else toast.error("Action failed");
  };
  const del = async () => { setBusy(true); const r = await fetch(`/api/systems/brief-generation/briefs/${brief.id}`, { method: "DELETE" }); setBusy(false); if (r.ok) { toast.success("Brief deleted"); reload(); } else toast.error("Delete failed"); };
  const generateCopy = async () => {
    setBusy(true);
    const r = await fetch(`/api/systems/ad-copy/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId, briefId: brief.id, placement: "feed", variantCount: 3, funnelStage: brief.funnelStage }) });
    setBusy(false);
    if (r.ok) { toast.success("Generating ad copy — see the Ad Copy library."); router.push("/s/ad-copy"); } else toast.error(((await r.json().catch(() => ({}))) as { error?: string })?.error ?? "Couldn't start copy");
  };
  const toProduction = async () => { await sendBriefToProduction(brief); await act({ sentToProduction: isVideo ? "video" : "static" }); router.push(isVideo ? "/s/video-generation" : "/s/static-generation"); };

  return (
    <BentoCard className={cn("space-y-3 p-5", brief.complianceNotesJson?.flag === "banned" && "border-destructive/40")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent/12 text-accent">{isVideo ? <Film className="size-4" /> : <LayoutGrid className="size-4" />}</span>
          <div>
            <h3 className="font-display text-[15px] font-semibold capitalize leading-tight">{brief.format} brief</h3>
            <p className="text-[11px] text-muted-foreground">{brief.funnelStage ?? "TOF"}{brief.b3Version ? ` · B3 v${brief.b3Version}` : ""}{brief.costCents ? ` · ${brief.costCents}¢` : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={comp.variant} className="gap-1">{comp.icon}{comp.label}</Badge>
          <Badge variant={brief.status === "approved" ? "success" : brief.status === "failed" ? "outline" : "muted"}>{brief.status}</Badge>
          {brief.sentToProduction && <Badge variant="outline">→ {brief.sentToProduction}</Badge>}
        </div>
      </div>

      {brief.status === "pending" || brief.status === "running" ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Generating the brief…</div>
      ) : brief.status === "failed" ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-foreground/80">Failed{brief.errorMessage ? `: ${brief.errorMessage}` : ""}. Use Regenerate to retry.</p>
      ) : (
        <BriefBody brief={brief} isVideo={isVideo} />
      )}

      {(brief.complianceNotesJson?.notes?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/8 p-2.5 text-[11px] text-foreground/80">
          <p className="mb-1 flex items-center gap-1 font-medium text-warning"><AlertTriangle className="size-3" /> Compliance notes (carry to production)</p>
          <ul className="list-disc space-y-0.5 pl-4">{brief.complianceNotesJson!.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}

      {(brief.status === "complete" || brief.status === "approved") && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border/50 pt-2">
          {brief.status !== "approved" && <Button size="sm" variant="ghost" onClick={() => act({ status: "approved" }, "Approved")} disabled={busy} title="Approve"><Check className="size-3.5" /> Approve</Button>}
          <Button size="sm" variant="ghost" onClick={generateCopy} disabled={busy} title="Generate ad copy"><PenSquare className="size-3.5" /> Copy</Button>
          <Button size="sm" variant="ghost" onClick={toProduction} disabled={busy} title="Send to production"><Send className="size-3.5" /> Production</Button>
          <Button size="sm" variant="ghost" onClick={() => act({ action: "regenerate" }, "Regenerating…")} disabled={busy} title="Regenerate"><RefreshCw className="size-3.5" /></Button>
          <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={del} disabled={busy} title="Delete"><Trash2 className="size-3.5" /></Button>
        </div>
      )}
    </BentoCard>
  );
}

function BriefBody({ brief, isVideo }: { brief: Brief; isVideo: boolean }) {
  const j = (brief.briefJson ?? {}) as VideoBriefJson & StaticBriefJson;
  if (isVideo) {
    return (
      <div className="space-y-2.5 text-sm">
        {j.hook_frame && <Field label="Hook frame" value={j.hook_frame} />}
        {Array.isArray(j.scene_list) && j.scene_list.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Scene list</p>
            <div className="space-y-1.5">
              {j.scene_list.map((s, i) => (
                <div key={i} className="rounded-lg bg-muted/40 p-2 text-xs">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>{s.shot_type ?? "shot"}</span>{s.duration_s ? <span>{s.duration_s}s</span> : null}</div>
                  {s.visual && <p className="text-foreground/85"><span className="text-muted-foreground">Visual:</span> {s.visual}</p>}
                  {s.vo && <p className="text-foreground/85"><span className="text-muted-foreground">VO:</span> “{s.vo}”</p>}
                  {s.on_screen_text && <p className="text-foreground/70"><span className="text-muted-foreground">On-screen:</span> {s.on_screen_text}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
        {j.cta_frame && <Field label="CTA frame" value={j.cta_frame} />}
        {j.pacing_notes && <Field label="Pacing" value={j.pacing_notes} />}
      </div>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      {Array.isArray(j.frames) && j.frames.map((f, i) => (
        <div key={i} className="rounded-lg bg-muted/40 p-2 text-xs">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Frame {i + 1}</p>
          {f.headline && <p className="font-medium text-foreground/90">{f.headline}</p>}
          {f.subhead && <p className="text-foreground/75">{f.subhead}</p>}
          {f.layout && <p className="text-muted-foreground"><span className="font-medium">Layout:</span> {f.layout}</p>}
          {f.product_placement && <p className="text-muted-foreground"><span className="font-medium">Product:</span> {f.product_placement}</p>}
          {f.proof_element && <p className="text-muted-foreground"><span className="font-medium">Proof:</span> {f.proof_element}</p>}
          {f.cta && <p className="text-accent">{f.cta}</p>}
        </div>
      ))}
      {Array.isArray(j.format_intent) && j.format_intent.length > 0 && <p className="text-[11px] text-muted-foreground">Formats: {j.format_intent.join(" · ")}</p>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <p className="text-sm"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}: </span><span className="text-foreground/85">{value}</span></p>;
}
