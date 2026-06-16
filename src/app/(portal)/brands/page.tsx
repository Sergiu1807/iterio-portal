"use client";

import { useRouter } from "next/navigation";
import { Plus, Check } from "lucide-react";
import { useBrand } from "@/lib/brand-store";
import { navSystems } from "@/systems/registry";
import { PageHeader } from "@/components/shared/page-header";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/ui/brand-mark";

export default function BrandsPage() {
  const router = useRouter();
  const { brands, currentBrandId, setCurrentBrand } = useBrand();
  const systems = navSystems();

  const open = (id: string, slug: string) => {
    setCurrentBrand(id);
    router.push(`/brands/${slug}`);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Brands"
        description="Every brand is instantly usable across all systems. Add one and it's populated and ready."
        actions={
          <Button onClick={() => router.push("/brands/new")}>
            <Plus className="size-4" /> Add a brand
          </Button>
        }
      />

      <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {brands.map((b) => {
          const enabled = systems.filter(
            (s) => b.enabledSystems[s.key] ?? s.enabledByDefault
          ).length;
          const active = b.id === currentBrandId;
          return (
            <BentoCard
              key={b.id}
              interactive
              onClick={() => open(b.id, b.slug)}
              className="relative flex flex-col p-5"
            >
              {active && (
                <Badge variant="success" className="absolute right-4 top-4">
                  <Check className="size-3" /> Active
                </Badge>
              )}
              <BrandMark name={b.name} color={b.brandColor} size={48} />
              <h3 className="mt-3.5 font-display text-lg font-medium tracking-tight">{b.name}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{b.tagline ?? b.category}</p>
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {b.cluster && <Badge variant="muted">{b.cluster}</Badge>}
                {b.primaryMarket && <Badge variant="outline">{b.primaryMarket}</Badge>}
                <Badge variant={b.status === "Active" ? "default" : "muted"}>{b.status}</Badge>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3.5 text-xs text-muted-foreground">
                <span>{b.products.length} products · {b.personas.length} personas</span>
                <span className="font-medium text-foreground/70">{enabled}/{systems.length} systems on</span>
              </div>
            </BentoCard>
          );
        })}

        <button
          onClick={() => router.push("/brands/new")}
          className="flex min-h-[200px] flex-col items-center justify-center gap-2.5 rounded-[var(--radius)] border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          <span className="flex size-12 items-center justify-center rounded-[28%] bg-muted">
            <Plus className="size-5" />
          </span>
          <span className="text-sm font-medium">Add a brand</span>
        </button>
      </div>
    </div>
  );
}
