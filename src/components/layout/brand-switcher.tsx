"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown, Plus } from "lucide-react";
import { useBrand } from "@/lib/brand-store";
import { BrandMark } from "@/components/ui/brand-mark";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";

export function BrandSwitcher() {
  const router = useRouter();
  const { brands, currentBrand, currentBrandId, setCurrentBrand } = useBrand();

  // group by cluster
  const groups = new Map<string, typeof brands>();
  for (const b of brands) {
    const key = b.cluster || "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-3 rounded-2xl border border-sidebar-border/70 bg-sidebar-surface/60 px-3 py-2.5 text-left transition-colors hover:bg-sidebar-surface"
        >
          {currentBrand ? (
            <BrandMark name={currentBrand.name} color={currentBrand.brandColor} size={34} />
          ) : (
            <span className="size-[34px] rounded-[30%] bg-sidebar-border" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-sidebar-foreground">
              {currentBrand?.name ?? "Select a brand"}
            </span>
            <span className="block truncate text-xs text-sidebar-muted">
              {currentBrand?.cluster ?? "—"}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-64">
        {[...groups.entries()].map(([cluster, list], i) => (
          <div key={cluster}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{cluster}</DropdownMenuLabel>
            {list.map((b) => (
              <DropdownMenuItem key={b.id} onSelect={() => setCurrentBrand(b.id)}>
                <BrandMark name={b.name} color={b.brandColor} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{b.name}</span>
                </span>
                <DropdownMenuCheck active={b.id === currentBrandId} />
              </DropdownMenuItem>
            ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/brands/new")} className="text-primary">
          <span className="flex size-[26px] items-center justify-center rounded-[30%] border border-dashed border-primary/40">
            <Plus className="size-4" />
          </span>
          <span className="text-sm font-medium">Add a brand</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
