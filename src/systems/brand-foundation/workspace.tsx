"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { BentoCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBrand } from "@/lib/brand-store";
import type { BrandSource, IntelRow, OnboardStep } from "./ui-types";
import { StepInputs } from "./step-inputs";
import { B3Editor } from "./b3-editor";
import { StepApprove } from "./step-approve";

const STEPS: { key: OnboardStep; label: string }[] = [
  { key: "inputs", label: "Inputs" },
  { key: "review", label: "Review & edit" },
  { key: "approve", label: "Approve" },
];

export default function OnboardingWorkspace({ brandId }: { brandId: string }) {
  const { currentBrand, refresh } = useBrand();
  const [sources, setSources] = useState<BrandSource[]>([]);
  const [row, setRow] = useState<IntelRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<OnboardStep>("inputs");

  const loadSources = useCallback(async () => {
    const r = await fetch(`/api/brand-foundation/sources?brandId=${brandId}`);
    if (r.ok) setSources(((await r.json()) as { sources: BrandSource[] }).sources ?? []);
  }, [brandId]);
  const loadB3 = useCallback(async () => {
    const r = await fetch(`/api/brand-foundation/b3?brandId=${brandId}`);
    if (r.ok) setRow(((await r.json()) as { row: IntelRow }).row);
    setLoading(false);
  }, [brandId]);

  useEffect(() => { loadSources(); loadB3(); }, [loadSources, loadB3]);
  useEffect(() => { if (row?.status === "approved") setStep((s) => (s === "inputs" ? "approve" : s)); }, [row?.status]);

  const editAfterApprove = async () => {
    const res = await fetch(`/api/brand-foundation/b3/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId }) });
    if (res.ok) { setRow(((await res.json()) as { row: IntelRow }).row); setStep("review"); }
  };

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Foundation" title="Brand Onboarding" description={`Build ${currentBrand?.name ?? "this brand"}'s evidence-backed Brand Intelligence (B3) — the grounding every system reads.`} />

      <div className="flex flex-wrap items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <button
              onClick={() => setStep(s.key)}
              className={cn("flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors", step === s.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              <span className={cn("flex size-5 items-center justify-center rounded-full text-xs", step === s.key ? "bg-white/20" : "bg-muted")}>{i + 1}</span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" />}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : step === "inputs" ? (
        <StepInputs brandId={brandId} sources={sources} onSaved={loadSources} onContinue={() => { loadB3(); setStep("review"); }} />
      ) : step === "review" ? (
        row ? (
          <div className="space-y-3">
            {row.status === "approved" && (
              <BentoCard className="flex flex-wrap items-center justify-between gap-2 p-4">
                <span className="text-sm text-muted-foreground">v{row.version} is approved (read-only).</span>
                <Button size="sm" onClick={editAfterApprove}>Edit → new draft</Button>
              </BentoCard>
            )}
            <B3Editor row={row} brandId={brandId} readOnly={row.status === "approved"} onReload={loadB3} />
          </div>
        ) : null
      ) : row ? (
        <StepApprove row={row} brandId={brandId} onApproved={() => { loadB3(); refresh(); }} />
      ) : null}
    </div>
  );
}
