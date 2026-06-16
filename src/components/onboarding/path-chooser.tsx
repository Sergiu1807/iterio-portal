"use client";

import { Sparkles, ClipboardPaste, ListChecks, ArrowRight } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type OnboardPath = "research" | "paste" | "wizard";

const OPTIONS: {
  key: OnboardPath;
  icon: typeof Sparkles;
  title: string;
  desc: string;
  accent: string;
  badge?: string;
}[] = [
  {
    key: "research",
    icon: Sparkles,
    title: "AI auto-research",
    desc: "Give a name and website. We research the brand, draft the full intelligence, and extract a palette — you review and tweak.",
    accent: "#5A7A64",
    badge: "Most magic",
  },
  {
    key: "paste",
    icon: ClipboardPaste,
    title: "Paste a doc",
    desc: "Already have a brand brief? Paste it and we'll split it into clean, editable sections automatically.",
    accent: "#C2785A",
  },
  {
    key: "wizard",
    icon: ListChecks,
    title: "Guided wizard",
    desc: "Fill it in step by step. The most control, and works with zero setup.",
    accent: "#6E5A86",
  },
];

export function PathChooser({ onChoose }: { onChoose: (p: OnboardPath) => void }) {
  return (
    <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-3">
      {OPTIONS.map((o) => (
        <BentoCard
          key={o.key}
          interactive
          onClick={() => onChoose(o.key)}
          className="group relative flex flex-col overflow-hidden p-6"
        >
          <div
            className="pointer-events-none absolute -right-6 -top-6 size-28 rounded-full opacity-[0.12] blur-2xl transition-opacity group-hover:opacity-25"
            style={{ background: o.accent }}
          />
          <div className="mb-4 flex items-center justify-between">
            <span className="flex size-12 items-center justify-center rounded-[28%]" style={{ background: `${o.accent}22`, color: o.accent }}>
              <o.icon className="size-6" />
            </span>
            {o.badge && <Badge variant="accent">{o.badge}</Badge>}
          </div>
          <h3 className="font-display text-lg font-medium tracking-tight">{o.title}</h3>
          <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{o.desc}</p>
          <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: o.accent }}>
            Choose <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </BentoCard>
      ))}
    </div>
  );
}
