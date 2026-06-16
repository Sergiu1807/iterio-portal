"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { BrandDraft, SectionType } from "@/lib/types";
import { pickPalette } from "@/lib/onboarding/draft";
import { BentoCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STEP_LABELS = ["Basics", "Market & voice", "Substance"];

export function WizardFlow({ onComplete }: { onComplete: (draft: BrandDraft) => void }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    name: "",
    website: "",
    category: "",
    brandColor: "#5A7A64",
    primaryMarket: "",
    currency: "",
    cluster: "",
    vibe: "",
    mission: "",
    audience: "",
    voice: "",
    products: "",
    usps: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const canNext = step === 0 ? !!f.name.trim() : true;

  const finish = () => {
    const pal = pickPalette(f.name || "brand");
    const sections: BrandDraft["sections"] = [];
    const push = (type: SectionType, title: string, content: string) => {
      if (content.trim()) sections.push({ sectionType: type, title, content: content.trim(), sortOrder: sections.length });
    };
    push("identity", "Core Identity & Mission", f.mission);
    push("audience", "Target Customer Profile", f.audience);
    push("voice", "Brand Voice & Tone", f.voice);

    const products = f.products.split("\n").map((l) => l.trim()).filter(Boolean).map((name) => ({ name }));
    const usps = f.usps.split("\n").map((l) => l.trim()).filter(Boolean).map((text) => ({ text }));

    onComplete({
      name: f.name.trim(),
      website: f.website.trim() || undefined,
      category: f.category.trim() || undefined,
      primaryMarket: f.primaryMarket.trim() || undefined,
      currency: f.currency.trim() || undefined,
      cluster: f.cluster.trim() || undefined,
      vibe: f.vibe.trim() || undefined,
      brandColor: f.brandColor,
      palette: [{ hex: f.brandColor, role: "primary" }, ...pal.palette.slice(1)],
      onboardingSource: "wizard",
      sections,
      products,
      personas: [],
      usps,
      competitors: [],
    });
  };

  return (
    <BentoCard className="p-6 md:p-8">
      {/* stepper */}
      <div className="mb-7 flex items-center gap-2">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                i <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}
            >
              {i + 1}
            </span>
            <span className={cn("text-sm font-medium", i <= step ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < STEP_LABELS.length - 1 && <span className="h-px flex-1 bg-border" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Wf label="Brand name" required><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Brand name" /></Wf>
          <Wf label="Website"><Input value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" /></Wf>
          <Wf label="Category"><Input value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Supplements" /></Wf>
          <Wf label="Brand color">
            <div className="flex items-center gap-2">
              <input type="color" value={f.brandColor} onChange={(e) => set("brandColor", e.target.value)} className="size-10 cursor-pointer rounded-lg border border-border bg-transparent" />
              <span className="font-mono text-xs text-muted-foreground">{f.brandColor}</span>
            </div>
          </Wf>
        </div>
      )}

      {step === 1 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Wf label="Primary market"><Input value={f.primaryMarket} onChange={(e) => set("primaryMarket", e.target.value)} placeholder="United States" /></Wf>
          <Wf label="Currency"><Input value={f.currency} onChange={(e) => set("currency", e.target.value)} placeholder="USD" /></Wf>
          <Wf label="Cluster"><Input value={f.cluster} onChange={(e) => set("cluster", e.target.value)} placeholder="e.g. Wellness" /></Wf>
          <Wf label="Vibe"><Input value={f.vibe} onChange={(e) => set("vibe", e.target.value)} placeholder="Warm · premium · calm" /></Wf>
          <Wf label="Brand voice & tone" full><Textarea value={f.voice} onChange={(e) => set("voice", e.target.value)} placeholder="How does the brand speak?" /></Wf>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Wf label="Mission / identity"><Textarea value={f.mission} onChange={(e) => set("mission", e.target.value)} placeholder="What the brand is and why it exists." /></Wf>
          <Wf label="Target audience"><Textarea value={f.audience} onChange={(e) => set("audience", e.target.value)} placeholder="Who it's for." /></Wf>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Wf label="Hero products (one per line)"><Textarea value={f.products} onChange={(e) => set("products", e.target.value)} placeholder={"Product A\nProduct B"} /></Wf>
            <Wf label="USPs (one per line)"><Textarea value={f.usps} onChange={(e) => set("usps", e.target.value)} placeholder={"Third-party tested\nRefillable"} /></Wf>
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        {step < 2 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
            Continue <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button onClick={finish} disabled={!f.name.trim()}>
            Review brand <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </BentoCard>
  );
}

function Wf({ label, required, full, children }: { label: string; required?: boolean; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", full && "sm:col-span-2")}>
      <Label>
        {label}
        {required && <span className="text-accent"> *</span>}
      </Label>
      {children}
    </div>
  );
}
