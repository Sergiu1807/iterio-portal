"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Star, Check, Send, Copy, RefreshCw, Pencil, Trash2, ShieldAlert, ShieldCheck, ShieldX, X } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { IdeationAngle } from "./ui-types";

const COMPLIANCE: Record<string, { variant: NonNullable<BadgeProps["variant"]>; icon: React.ReactNode; label: string }> = {
  safe: { variant: "success", icon: <ShieldCheck className="size-3" />, label: "compliant" },
  risky: { variant: "warning", icon: <ShieldAlert className="size-3" />, label: "risky" },
  banned: { variant: "outline", icon: <ShieldX className="size-3" />, label: "banned" },
};
const STATUS: Record<string, NonNullable<BadgeProps["variant"]>> = { draft: "muted", shortlisted: "warning", approved: "success", sent_to_brief: "outline" };

export function AngleCard({ brandId, angle, onChange }: { brandId: string; angle: IdeationAngle; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: angle.title, hook: angle.hook ?? "", bigIdea: angle.bigIdea ?? "" });

  const comp = COMPLIANCE[angle.complianceFlag] ?? COMPLIANCE.safe;

  const patch = async (body: Record<string, unknown>, msg?: string) => {
    setBusy(true);
    const r = await fetch(`/api/systems/ideation/angles/${angle.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { if (msg) toast.success(msg); onChange(); } else toast.error("Update failed");
  };
  const del = async () => {
    setBusy(true);
    const r = await fetch(`/api/systems/ideation/angles/${angle.id}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok) { toast.success("Angle deleted"); onChange(); } else toast.error("Delete failed");
  };
  const regenerate = async () => {
    setBusy(true);
    const r = await fetch(`/api/systems/ideation/regenerate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId, angleId: angle.id }) });
    setBusy(false);
    if (r.ok) { toast.success("Regenerating similar angles…"); onChange(); } else toast.error("Couldn't regenerate");
  };
  const copy = () => {
    const text = `${angle.title}\n\nHook: ${angle.hook ?? ""}\n\nBig idea: ${angle.bigIdea ?? ""}\n\nDriver: ${angle.emotionalDriver ?? ""} · Persona: ${angle.targetPersona ?? ""} · Proof: ${angle.proofMechanism ?? ""}`;
    navigator.clipboard.writeText(text).then(() => toast.success("Copied")).catch(() => {});
  };
  const saveEdit = async () => { await patch({ title: draft.title, hook: draft.hook, bigIdea: draft.bigIdea }, "Saved"); setEditing(false); };

  return (
    <BentoCard className={cn("flex flex-col gap-2.5 p-4", angle.complianceFlag === "banned" && "border-destructive/40")}>
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} className="h-8 text-sm font-medium" />
        ) : (
          <h3 className="font-display text-[15px] font-semibold leading-snug">{angle.title}</h3>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {angle.score && <span className="text-xs font-medium text-muted-foreground">{Number(angle.score).toFixed(1)}</span>}
          <Badge variant={comp.variant} className="gap-1">{comp.icon}{comp.label}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[10px]">
        {angle.format && <Badge variant="muted" className="capitalize">{angle.format}</Badge>}
        {angle.funnelStage && <Badge variant="muted">{angle.funnelStage}</Badge>}
        {angle.emotionalDriver && <Badge variant="muted">{angle.emotionalDriver}</Badge>}
        <Badge variant={STATUS[angle.status] ?? "muted"}>{angle.status.replace(/_/g, " ")}</Badge>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea value={draft.hook} onChange={(e) => setDraft((d) => ({ ...d, hook: e.target.value }))} rows={2} placeholder="Hook" className="text-xs" />
          <Textarea value={draft.bigIdea} onChange={(e) => setDraft((d) => ({ ...d, bigIdea: e.target.value }))} rows={3} placeholder="Big idea" className="text-xs" />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft({ title: angle.title, hook: angle.hook ?? "", bigIdea: angle.bigIdea ?? "" }); }}><X className="size-3.5" /> Cancel</Button>
            <Button size="sm" onClick={saveEdit} disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save</Button>
          </div>
        </div>
      ) : (
        <>
          {angle.hook && <p className="text-sm font-medium text-foreground/90">“{angle.hook}”</p>}
          {angle.bigIdea && <p className="text-xs leading-relaxed text-muted-foreground">{angle.bigIdea}</p>}
          <dl className="grid grid-cols-1 gap-0.5 text-[11px] text-muted-foreground">
            {angle.targetPersona && <div><span className="font-medium text-foreground/70">Persona:</span> {angle.targetPersona}</div>}
            {angle.proofMechanism && <div><span className="font-medium text-foreground/70">Proof:</span> {angle.proofMechanism}</div>}
            {angle.sourceInspiration && <div><span className="font-medium text-foreground/70">Drawn from:</span> {angle.sourceInspiration}</div>}
            {angle.differentiationNote && <div><span className="font-medium text-foreground/70">Distinct:</span> {angle.differentiationNote}</div>}
            {angle.ruleRef && <div className="text-warning"><span className="font-medium">⚠ {angle.ruleRef}</span></div>}
          </dl>
        </>
      )}

      {!editing && (
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
          <Button size="sm" variant="ghost" onClick={() => patch({ status: "shortlisted" }, "Shortlisted")} disabled={busy} title="Shortlist"><Star className="size-3.5" /></Button>
          <Button size="sm" variant="ghost" onClick={() => patch({ status: "approved" }, "Approved")} disabled={busy} title="Approve"><Check className="size-3.5" /></Button>
          <Button size="sm" variant="ghost" onClick={() => patch({ status: "sent_to_brief" }, "Sent to brief")} disabled={busy || angle.complianceFlag === "banned"} title="Send to brief"><Send className="size-3.5" /></Button>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy} title="Edit"><Pencil className="size-3.5" /></Button>
          <Button size="sm" variant="ghost" onClick={regenerate} disabled={busy} title="Regenerate similar"><RefreshCw className="size-3.5" /></Button>
          <Button size="sm" variant="ghost" onClick={copy} disabled={busy} title="Copy to clipboard"><Copy className="size-3.5" /></Button>
          <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={del} disabled={busy} title="Delete"><Trash2 className="size-3.5" /></Button>
        </div>
      )}
    </BentoCard>
  );
}
