"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutDashboard, Building2, BookOpen, Plus } from "lucide-react";
import { useBrand } from "@/lib/brand-store";
import { navSystems } from "@/systems/registry";
import { BrandMark } from "@/components/ui/brand-mark";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

export function CommandPalette() {
  const router = useRouter();
  const { brands, setCurrentBrand } = useBrand();
  const [open, setOpen] = useState(false);
  const systems = navSystems();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to a brand, system or page…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => run(() => router.push("/dashboard"))}>
            <LayoutDashboard className="size-4 text-muted-foreground" /> Dashboard
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/brands"))}>
            <Building2 className="size-4 text-muted-foreground" /> Brands
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/brand-intelligence"))}>
            <BookOpen className="size-4 text-muted-foreground" /> Brand Intelligence
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/brands/new"))}>
            <Plus className="size-4 text-muted-foreground" /> Add a brand
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Systems">
          {systems.map((s) => (
            <CommandItem key={s.key} onSelect={() => run(() => router.push(`/s/${s.key}`))}>
              <s.icon className="size-4" style={{ color: s.accent }} />
              {s.name}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Switch brand">
          {brands.map((b) => (
            <CommandItem
              key={b.id}
              value={`brand ${b.name}`}
              onSelect={() => run(() => setCurrentBrand(b.id))}
            >
              <BrandMark name={b.name} color={b.brandColor} size={22} />
              {b.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
