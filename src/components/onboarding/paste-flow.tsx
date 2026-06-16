"use client";

import { useState } from "react";
import { ClipboardPaste, FileText } from "lucide-react";
import type { BrandDraft } from "@/lib/types";
import { parseMarkdownToSections, pickPalette } from "@/lib/onboarding/draft";
import { BentoCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";

const SAMPLE = `# Core Identity
Northwind is a outdoor coffee brand for trail runners and hikers — fast, light, and genuinely good in a cup. Mission: fuel the first mile and the last.

# Audience
Active 25–40s who pack light and care about ritual. They buy gear that earns its weight.

# Products
- Trail Instant (single-serve specialty instant)
- Summit Roast (whole bean)
- The Pack (sampler)

# Voice & Tone
Energetic, plainspoken, a little rugged. No fluff. Talks like a fellow runner.

# Competitors
Alpine Start, Kuju. We win on taste + sustainability.

# Guardrails
No medical/energy claims about caffeine. Keep sustainability claims sourced.`;

export function PasteFlow({ onComplete }: { onComplete: (draft: BrandDraft) => void }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [color, setColor] = useState("");
  const [doc, setDoc] = useState("");

  const submit = () => {
    if (!name.trim() || !doc.trim()) return;
    const pal = pickPalette(name);
    onComplete({
      name: name.trim(),
      website: website.trim() || undefined,
      brandColor: color || pal.brandColor,
      palette: pal.palette,
      onboardingSource: "paste",
      sections: parseMarkdownToSections(doc),
      products: [],
      personas: [],
      usps: [],
      competitors: [],
    });
  };

  return (
    <div className="space-y-4">
      <BentoCard className="p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Brand name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Northwind" />
          </div>
          <div className="space-y-1.5">
            <Label>Website (optional)</Label>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
          </div>
          <div className="space-y-1.5">
            <Label>Brand color (optional)</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color || "#5A7A64"}
                onChange={(e) => setColor(e.target.value)}
                className="size-10 cursor-pointer rounded-lg border border-border bg-transparent"
              />
              <span className="font-mono text-xs text-muted-foreground">{color || "auto"}</span>
            </div>
          </div>
        </div>
      </BentoCard>

      <BentoCard className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardPaste className="size-4 text-accent" />
            <h2 className="font-display text-lg font-medium tracking-tight">Paste your brand doc</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setDoc(SAMPLE)}>
            <FileText className="size-4" /> Load sample
          </Button>
        </div>
        <Textarea
          value={doc}
          onChange={(e) => setDoc(e.target.value)}
          placeholder="Paste markdown — we split on # / ## / ### headings into editable sections…"
          className="min-h-[300px] font-mono text-[13px]"
        />
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Headings become sections, auto-typed (voice, audience, products…).
          </p>
          <Button onClick={submit} disabled={!name.trim() || !doc.trim()}>
            Parse & review
          </Button>
        </div>
      </BentoCard>
    </div>
  );
}
