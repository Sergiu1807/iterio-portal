"use client";

import { useState } from "react";
import { Compass, Loader2, Globe, ArrowRight } from "lucide-react";
import type { BrandDraft } from "@/lib/types";
import { BentoCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

/** Clean intake → creates the brand, then hands off to the real Brand Foundation
 *  engine (/onboarding) where its B3 is actually researched. No fabricated draft. */
export function ResearchFlow({ onComplete }: { onComplete: (draft: BrandDraft) => void }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = () => {
    if (!name.trim()) return;
    setSubmitting(true);
    onComplete({
      name: name.trim(),
      website: website.trim() || undefined,
      category: category.trim() || undefined,
      onboardingSource: "research",
      brandColor: "",
      palette: [],
      sections: [],
      products: [],
      personas: [],
      usps: [],
      competitors: [],
    });
  };

  return (
    <div className="mx-auto max-w-xl">
      <BentoCard className="p-6 md:p-8">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent/12 text-accent"><Compass className="size-4.5" /></span>
          <div>
            <h2 className="font-display text-lg font-medium tracking-tight">Add a brand to research</h2>
            <p className="text-xs text-muted-foreground">We&apos;ll create it, then take you into Brand Foundation to research &amp; build its real intelligence.</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Brand name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lumen Skincare" disabled={submitting} />
          </div>
          <div className="space-y-1.5">
            <Label>Website <span className="text-muted-foreground">(optional)</span></Label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" className="pl-9" disabled={submitting} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Category <span className="text-muted-foreground">(optional)</span></Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Clean skincare" disabled={submitting} />
          </div>
          <Button onClick={submit} disabled={!name.trim() || submitting} className="cta-glow w-full" size="lg">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {submitting ? "Creating…" : "Create & build intelligence"}
          </Button>
        </div>
      </BentoCard>
    </div>
  );
}
