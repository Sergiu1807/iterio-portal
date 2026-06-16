"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Check, Loader2, Globe } from "lucide-react";
import type { BrandDraft } from "@/lib/types";
import { synthesizeFromResearch } from "@/lib/onboarding/draft";
import { BentoCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STEPS = [
  "Fetching site & search results",
  "Reading positioning & voice",
  "Drafting brand intelligence",
  "Extracting palette & identity",
  "Assembling draft",
];

export function ResearchFlow({ onComplete }: { onComplete: (draft: BrandDraft) => void }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [category, setCategory] = useState("");
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(-1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const run = () => {
    if (!name.trim()) return;
    setRunning(true);
    setStep(0);
    STEPS.forEach((_, i) => {
      timers.current.push(
        setTimeout(() => setStep(i + 1), (i + 1) * 620)
      );
    });
    timers.current.push(
      setTimeout(() => {
        onComplete(synthesizeFromResearch({ name: name.trim(), website: website.trim() || undefined, category: category.trim() || undefined }));
      }, STEPS.length * 620 + 350)
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <BentoCard className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h2 className="font-display text-lg font-medium tracking-tight">Research a brand</h2>
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Brand name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lumen Skincare" disabled={running} />
          </div>
          <div className="space-y-1.5">
            <Label>Website (optional)</Label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" className="pl-9" disabled={running} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Category (optional)</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Clean skincare" disabled={running} />
          </div>
          <Button onClick={run} disabled={!name.trim() || running} className="w-full" size="lg">
            {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {running ? "Researching…" : "Research brand"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Prototype — synthesizes a believable draft locally. In production this runs a real research agent (web + Claude) and palette extraction.
          </p>
        </div>
      </BentoCard>

      <BentoCard className="brand-wash p-6">
        <h3 className="mb-4 font-display text-base font-medium">Progress</h3>
        <ul className="space-y-3">
          {STEPS.map((s, i) => {
            const done = step > i + 1 || (!running && step === STEPS.length);
            const active = running && step === i + 1;
            const reached = step >= i + 1;
            return (
              <li key={s} className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full transition-colors",
                    reached && !active ? "bg-success/15 text-success" : active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                  )}
                >
                  {active ? <Loader2 className="size-3.5 animate-spin" /> : reached ? <Check className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}
                </span>
                <span className={cn("text-sm", reached ? "text-foreground" : "text-muted-foreground")}>{s}</span>
              </li>
            );
          })}
        </ul>
        {!running && (
          <p className="mt-6 text-sm text-muted-foreground">
            Enter a name and press <span className="font-medium text-foreground">Research brand</span> to watch the draft assemble.
          </p>
        )}
      </BentoCard>
    </div>
  );
}
