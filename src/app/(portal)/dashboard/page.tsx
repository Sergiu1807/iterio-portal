"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Plus, Layers, Boxes, CheckCircle2 } from "lucide-react";
import { useBrand } from "@/lib/brand-store";
import { SYSTEMS, navSystems } from "@/systems/registry";
import { Button } from "@/components/ui/button";
import { BentoCard } from "@/components/ui/card";
import { BrandMark } from "@/components/ui/brand-mark";
import { Badge } from "@/components/ui/badge";
import { SystemCard } from "@/components/shared/system-card";

export default function DashboardPage() {
  const { currentBrand, brands, isReady } = useBrand();
  const [greeting, setGreeting] = useState("Welcome back");

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

  const systems = navSystems();
  const enabledFor = (key: string) =>
    currentBrand?.enabledSystems[key] ?? SYSTEMS.find((s) => s.key === key)?.enabledByDefault ?? false;
  const liveCount = systems.filter((s) => s.status === "live").length;
  const enabledCount = systems.filter((s) => enabledFor(s.key)).length;

  if (!isReady) {
    return (
      <div className="space-y-4">
        <div className="h-40 animate-pulse rounded-[var(--radius)] bg-muted/60" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-[var(--radius)] bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  if (!currentBrand) {
    return (
      <div className="py-20 text-center">
        <h1 className="font-display text-2xl font-medium">No brands yet</h1>
        <p className="mt-2 text-muted-foreground">Add your first brand to get started.</p>
        <Button asChild className="mt-5">
          <Link href="/brands/new">
            <Plus className="size-4" /> Add a brand
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Hero */}
      <BentoCard inset={false} className="brand-wash relative overflow-hidden border-border/60 p-7 md:p-9">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Workspace · {currentBrand.cluster ?? "Brand"}
            </p>
            <h1 className="font-display letterpress text-[32px] font-semibold leading-tight tracking-tight md:text-[40px]">
              {greeting}.
            </h1>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
              You&apos;re working in{" "}
              <span className="font-medium text-foreground">{currentBrand.name}</span>
              {currentBrand.tagline ? ` — ${currentBrand.tagline}` : "."}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <Button asChild size="sm">
                <Link href="/brand-intelligence">
                  <BookOpen className="size-4" /> Brand intelligence
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/brands/new">
                  <Plus className="size-4" /> Add a brand
                </Link>
              </Button>
            </div>
          </div>
          <div className="hidden shrink-0 md:block">
            <BrandMark name={currentBrand.name} color={currentBrand.brandColor} size={92} />
          </div>
        </div>
      </BentoCard>

      {/* Quick stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={Boxes} label="Brands in workspace" value={brands.length} />
        <StatCard icon={Layers} label="Systems available" value={systems.length} />
        <StatCard icon={CheckCircle2} label="Enabled for this brand" value={enabledCount} hint={`${liveCount} live`} />
      </div>

      {/* Systems */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="font-display text-xl font-medium tracking-tight">Systems</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Modular creative systems. Each plugs into every brand — wired up one at a time.
            </p>
          </div>
          <Badge variant="muted">{systems.length} modules</Badge>
        </div>
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {systems.map((s) => (
            <SystemCard key={s.key} system={s} enabled={enabledFor(s.key)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <BentoCard className="flex items-center gap-4 p-5">
      <span className="flex size-11 items-center justify-center rounded-[28%] bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <div>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-semibold tabular-nums">{value}</span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </BentoCard>
  );
}
