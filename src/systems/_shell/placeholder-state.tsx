"use client";

import Link from "next/link";
import { Check, Sparkles, ArrowRight, Wrench, Blocks } from "lucide-react";
import type { SystemDefinition } from "@/systems/types";
import { useBrand } from "@/lib/brand-store";
import { allInfraReady } from "@/lib/infra";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/ui/brand-mark";
import { InfraChecklist } from "./infra-checklist";

export function PlaceholderState({ system }: { system: SystemDefinition }) {
  const { currentBrand } = useBrand();
  const Icon = system.icon;
  const ready = allInfraReady(system.infra);

  return (
    <div className="space-y-7">
      {/* Hero */}
      <BentoCard
        inset={false}
        className="relative overflow-hidden border-border/60 p-7 md:p-9"
        style={{ background: `linear-gradient(135deg, ${system.accent}14, transparent 60%)` } as React.CSSProperties}
      >
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="mb-4 flex items-center gap-3">
              <span
                className="flex size-12 items-center justify-center rounded-[28%]"
                style={{ background: `${system.accent}26`, color: system.accent }}
              >
                <Icon className="size-6" />
              </span>
              <Badge variant="soon">Coming soon</Badge>
            </div>
            <h1 className="font-display letterpress text-[30px] font-semibold tracking-tight md:text-[36px]">
              {system.name}
            </h1>
            <p className="mt-2.5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              {system.description}
            </p>
          </div>

          {currentBrand && (
            <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-border/60 bg-card/70 px-4 py-3">
              <BrandMark name={currentBrand.name} color={currentBrand.brandColor} size={34} />
              <div className="text-sm">
                <p className="text-muted-foreground">Will be tuned for</p>
                <p className="font-medium">{currentBrand.name}</p>
              </div>
            </div>
          )}
        </div>
      </BentoCard>

      {/* What it'll do + setup */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <BentoCard className="p-6 lg:col-span-3">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="size-4" style={{ color: system.accent }} />
            <h2 className="font-display text-lg font-medium tracking-tight">What it&apos;ll do</h2>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {system.capabilities.map((c) => (
              <li key={c} className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
                  style={{ background: `${system.accent}22`, color: system.accent }}
                >
                  <Check className="size-3" />
                </span>
                <span className="text-sm leading-relaxed text-foreground/85">{c}</span>
              </li>
            ))}
          </ul>
        </BentoCard>

        <BentoCard className="p-6 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <Wrench className="size-4 text-muted-foreground" />
            <h2 className="font-display text-lg font-medium tracking-tight">Setup</h2>
            <Badge variant={ready ? "success" : "warning"} className="ml-auto">
              {ready ? "Ready" : "Needs setup"}
            </Badge>
          </div>
          <InfraChecklist infra={system.infra} />
          <p className="mt-5 border-t border-border/60 pt-4 text-xs leading-relaxed text-muted-foreground">
            These connect when the system is wired up. In the prototype, integrations are mocked.
          </p>
        </BentoCard>
      </div>

      {/* Ghost preview */}
      <BentoCard className="relative overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-3.5">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Interface preview
          </span>
          <span className="text-xs text-muted-foreground">In design</span>
        </div>
        <div className="relative p-6">
          <div className="pointer-events-none select-none opacity-50 blur-[1.5px]">
            <div className="mb-4 flex gap-2">
              <div className="h-8 w-28 rounded-full" style={{ background: `${system.accent}22` }} />
              <div className="h-8 w-24 rounded-full bg-muted" />
              <div className="h-8 w-20 rounded-full bg-muted" />
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-border/60 bg-surface p-4">
                  <div className="mb-3 h-24 rounded-xl" style={{ background: `${system.accent}14` }} />
                  <div className="mb-2 h-3 w-3/4 rounded-full bg-muted" />
                  <div className="h-3 w-1/2 rounded-full bg-muted" />
                </div>
              ))}
            </div>
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-border/70 bg-card/90 px-6 py-4 text-center backdrop-blur-sm">
              <span className="font-display text-base font-medium">Layout & functionality coming next</span>
              <span className="text-sm text-muted-foreground">We&apos;ll design and wire this system together.</span>
            </div>
          </div>
        </div>
      </BentoCard>

      {/* How it plugs in */}
      <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-dashed border-border px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Blocks className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            This is a modular slot. When it&apos;s built, it&apos;s live for{" "}
            <span className="font-medium text-foreground">every brand</span> — no rewiring.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/brand-intelligence">
            Review brand intelligence <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
