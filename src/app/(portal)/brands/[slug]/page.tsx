"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpen, Check, Trash2, PackageX, Boxes } from "lucide-react";
import { useBrand } from "@/lib/brand-store";
import { navSystems } from "@/systems/registry";
import { allInfraReady } from "@/lib/infra";
import { usePortalMeta } from "@/lib/portal-meta";
import { PageHeader } from "@/components/shared/page-header";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BrandMark } from "@/components/ui/brand-mark";
import { Markdown } from "@/components/ui/markdown";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export default function BrandDetailPage() {
  const params = useParams();
  const slug = String(params.slug ?? "");
  const router = useRouter();
  const { brands, currentBrandId, setCurrentBrand, updateBrand, removeBrand } = useBrand();
  const { configuredKeys } = usePortalMeta();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const brand = brands.find((b) => b.slug === slug);
  const systems = navSystems();

  if (!brand) {
    return (
      <EmptyState
        icon={PackageX}
        title="Brand not found"
        description={`No brand with slug "${slug}".`}
        action={
          <Button asChild variant="outline">
            <Link href="/brands">Back to brands</Link>
          </Button>
        }
      />
    );
  }

  const isActive = brand.id === currentBrandId;
  const enabledFor = (key: string, fallback?: boolean) => brand.enabledSystems[key] ?? fallback ?? false;
  const toggle = (key: string, val: boolean) =>
    updateBrand(brand.id, { enabledSystems: { ...brand.enabledSystems, [key]: val } });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={brand.cluster ?? "Brand"}
        title={brand.name}
        description={brand.tagline ?? brand.category}
        actions={
          <div className="flex items-center gap-2.5">
            {!isActive && (
              <Button variant="outline" onClick={() => setCurrentBrand(brand.id)}>
                Set as active
              </Button>
            )}
            <Button asChild>
              <Link href="/brand-intelligence" onClick={() => setCurrentBrand(brand.id)}>
                <BookOpen className="size-4" /> Brand intelligence
              </Link>
            </Button>
          </div>
        }
      />

      <BentoCard inset={false} className="brand-wash flex flex-wrap items-center gap-5 border-border/60 p-6">
        <BrandMark name={brand.name} color={brand.brandColor} size={64} />
        <div className="flex flex-wrap gap-2">
          {brand.vibe && <Badge variant="muted">{brand.vibe}</Badge>}
          {brand.primaryMarket && <Badge variant="outline">{brand.primaryMarket}</Badge>}
          {brand.currency && <Badge variant="outline">{brand.currency}</Badge>}
          {isActive && <Badge variant="success"><Check className="size-3" /> Active</Badge>}
        </div>
        <div className="ml-auto flex gap-6 text-center">
          <Stat n={brand.products.length} label="Products" />
          <Stat n={brand.personas.length} label="Personas" />
          <Stat n={brand.usps.length} label="USPs" />
          <Stat n={brand.competitors.length} label="Rivals" />
        </div>
      </BentoCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Systems enablement */}
        <BentoCard className="p-6 lg:col-span-3">
          <div className="mb-4 flex items-center gap-2">
            <Boxes className="size-4 text-muted-foreground" />
            <h2 className="font-display text-lg font-medium tracking-tight">Systems for this brand</h2>
          </div>
          <div className="space-y-1">
            {systems.map((s) => {
              const on = enabledFor(s.key, s.enabledByDefault);
              const ready = allInfraReady(s.infra, configuredKeys);
              return (
                <div key={s.key} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/50">
                  <span className="flex size-9 items-center justify-center rounded-[28%]" style={{ background: `${s.accent}1f`, color: s.accent }}>
                    <s.icon className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{s.name}</p>
                      {s.status === "placeholder" && <Badge variant="soon">Soon</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {ready ? "Ready to configure" : "Needs setup"}
                    </p>
                  </div>
                  <Switch checked={on} onCheckedChange={(v) => toggle(s.key, v)} aria-label={`Enable ${s.name}`} />
                </div>
              );
            })}
          </div>
        </BentoCard>

        {/* Intel snapshot */}
        <BentoCard className="p-6 lg:col-span-2">
          <h2 className="mb-4 font-display text-lg font-medium tracking-tight">Intelligence snapshot</h2>
          <div className="space-y-4">
            {brand.sections.slice(0, 3).map((s) => (
              <div key={s.id}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</p>
                <div className="line-clamp-3 text-sm">
                  <Markdown>{s.content}</Markdown>
                </div>
              </div>
            ))}
          </div>
          <Button asChild variant="ghost" size="sm" className="mt-4">
            <Link href="/brand-intelligence" onClick={() => setCurrentBrand(brand.id)}>
              View all {brand.sections.length} sections
            </Link>
          </Button>
        </BentoCard>
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmOpen(true)}>
          <Trash2 className="size-4" /> Remove brand
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {brand.name}?</DialogTitle>
            <DialogDescription>
              This removes the brand from your workspace (prototype — stored locally). This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex justify-end gap-2.5">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                removeBrand(brand.id);
                router.push("/brands");
              }}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="font-display text-xl font-semibold tabular-nums">{n}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
