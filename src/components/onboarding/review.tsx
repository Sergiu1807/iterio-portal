"use client";

import { ArrowLeft, Check, Boxes, Users, Star, Radar } from "lucide-react";
import type { BrandDraft } from "@/lib/types";
import { hexToHslTriplet } from "@/lib/color";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { BrandMark } from "@/components/ui/brand-mark";

export function OnboardingReview({
  draft,
  onChange,
  onConfirm,
  onBack,
}: {
  draft: BrandDraft;
  onChange: (d: BrandDraft) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const tint = hexToHslTriplet(draft.brandColor);
  const setField = <K extends keyof BrandDraft>(k: K, v: BrandDraft[K]) => onChange({ ...draft, [k]: v });
  const updateSection = (i: number, patch: Partial<BrandDraft["sections"][number]>) =>
    onChange({ ...draft, sections: draft.sections.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });

  return (
    <div className="space-y-5">
      {/* preview */}
      <div style={{ "--brand-tint": tint } as React.CSSProperties}>
        <BentoCard inset={false} className="brand-wash flex flex-wrap items-center gap-5 border-border/60 p-6">
          <BrandMark name={draft.name || "New Brand"} color={draft.brandColor} size={64} />
          <div className="min-w-[220px] flex-1 space-y-2">
            <div className="space-y-1.5">
              <Label>Brand name</Label>
              <Input value={draft.name} onChange={(e) => setField("name", e.target.value)} placeholder="Brand name" className="max-w-sm bg-card/70" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="space-y-1.5">
              <Label>Color</Label>
              <input
                type="color"
                value={draft.brandColor}
                onChange={(e) => setField("brandColor", e.target.value)}
                className="size-10 cursor-pointer rounded-lg border border-border bg-transparent"
              />
            </div>
            <Badge variant="muted" className="self-end">via {draft.onboardingSource}</Badge>
          </div>
        </BentoCard>
      </div>

      {/* summary chips */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryChip icon={Boxes} n={draft.products.length} label="Products" />
        <SummaryChip icon={Users} n={draft.personas.length} label="Personas" />
        <SummaryChip icon={Star} n={draft.usps.length} label="USPs" />
        <SummaryChip icon={Radar} n={draft.competitors.length} label="Competitors" />
      </div>

      {/* sections */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-medium tracking-tight">
            Intelligence — {draft.sections.length} sections
          </h2>
          <p className="text-sm text-muted-foreground">Tweak anything before creating.</p>
        </div>
        {draft.sections.length === 0 ? (
          <p className="rounded-[var(--radius)] border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            No sections — you can add them after creating the brand.
          </p>
        ) : (
          draft.sections.map((s, i) => (
            <BentoCard key={i} className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <Input
                  value={s.title}
                  onChange={(e) => updateSection(i, { title: e.target.value })}
                  className="h-9 max-w-md font-display text-base font-medium"
                />
                {s.sectionType && <Badge variant="muted">{s.sectionType}</Badge>}
              </div>
              <Textarea
                value={s.content}
                onChange={(e) => updateSection(i, { content: e.target.value })}
                className="min-h-[110px] font-mono text-[13px]"
              />
            </BentoCard>
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border/60 pt-5">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <Button size="lg" onClick={onConfirm} disabled={!draft.name.trim()}>
          <Check className="size-4" /> Create {draft.name || "brand"}
        </Button>
      </div>
    </div>
  );
}

function SummaryChip({
  icon: Icon,
  n,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  n: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-border/70 bg-card px-4 py-3">
      <Icon className="size-4 text-muted-foreground" />
      <span className="font-display text-lg font-semibold tabular-nums">{n}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
