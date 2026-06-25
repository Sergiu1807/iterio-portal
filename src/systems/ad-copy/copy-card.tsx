"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Check, Copy, Pencil, Trash2, ShieldAlert, ShieldCheck, ShieldX, X } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AdCopy } from "./ui-types";

const COMPLIANCE: Record<string, { variant: NonNullable<BadgeProps["variant"]>; icon: React.ReactNode; label: string }> = {
  safe: { variant: "success", icon: <ShieldCheck className="size-3" />, label: "compliant" },
  risky: { variant: "warning", icon: <ShieldAlert className="size-3" />, label: "risky" },
  banned: { variant: "outline", icon: <ShieldX className="size-3" />, label: "banned" },
};

export function CopyCard({ copy, onChange }: { copy: AdCopy; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ primaryText: copy.primaryText ?? "", headline: copy.headline ?? "", cta: copy.cta ?? "" });
  const comp = COMPLIANCE[copy.complianceFlag] ?? COMPLIANCE.safe;

  const patch = async (body: Record<string, unknown>, msg?: string) => {
    setBusy(true);
    const r = await fetch(`/api/systems/ad-copy/copy/${copy.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { if (msg) toast.success(msg); onChange(); } else toast.error("Update failed");
  };
  const del = async () => { setBusy(true); const r = await fetch(`/api/systems/ad-copy/copy/${copy.id}`, { method: "DELETE" }); setBusy(false); if (r.ok) { toast.success("Deleted"); onChange(); } else toast.error("Delete failed"); };
  const clip = () => { navigator.clipboard.writeText([copy.headline, copy.primaryText, copy.cta].filter(Boolean).join("\n\n")).then(() => toast.success("Copied")).catch(() => {}); };
  const saveEdit = async () => { await patch({ primaryText: draft.primaryText, headline: draft.headline, cta: draft.cta }, "Saved"); setEditing(false); };

  return (
    <BentoCard className={cn("flex flex-col gap-2 p-4", copy.complianceFlag === "banned" && "border-destructive/40")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Variant {copy.variantIndex} · {copy.placement}</span>
        <div className="flex items-center gap-1.5">
          <Badge variant={comp.variant} className="gap-1">{comp.icon}{comp.label}</Badge>
          <Badge variant={copy.status === "approved" ? "success" : "muted"}>{copy.status}</Badge>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Input value={draft.headline} onChange={(e) => setDraft((d) => ({ ...d, headline: e.target.value }))} placeholder="Headline" className="h-8 text-sm font-medium" />
          <Textarea value={draft.primaryText} onChange={(e) => setDraft((d) => ({ ...d, primaryText: e.target.value }))} rows={4} placeholder="Primary text" className="text-xs" />
          <Input value={draft.cta} onChange={(e) => setDraft((d) => ({ ...d, cta: e.target.value }))} placeholder="CTA" className="h-8 text-sm" />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft({ primaryText: copy.primaryText ?? "", headline: copy.headline ?? "", cta: copy.cta ?? "" }); }}><X className="size-3.5" /> Cancel</Button>
            <Button size="sm" onClick={saveEdit} disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save</Button>
          </div>
        </div>
      ) : (
        <>
          {copy.headline && <p className="font-display text-sm font-semibold leading-snug">{copy.headline}</p>}
          {copy.primaryText && <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">{copy.primaryText}</p>}
          {copy.cta && <p className="text-xs font-medium text-accent">{copy.cta}</p>}
          {copy.ruleRef && <p className="text-[11px] text-warning">⚠ {copy.ruleRef}</p>}
          <div className="mt-auto flex items-center gap-1 pt-1">
            {copy.status !== "approved" && <Button size="sm" variant="ghost" onClick={() => patch({ status: "approved" }, "Approved")} disabled={busy} title="Approve"><Check className="size-3.5" /></Button>}
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy} title="Edit"><Pencil className="size-3.5" /></Button>
            <Button size="sm" variant="ghost" onClick={clip} disabled={busy} title="Copy to clipboard"><Copy className="size-3.5" /></Button>
            <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={del} disabled={busy} title="Delete"><Trash2 className="size-3.5" /></Button>
          </div>
        </>
      )}
    </BentoCard>
  );
}
