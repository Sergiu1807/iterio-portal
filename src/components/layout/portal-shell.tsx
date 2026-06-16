"use client";

import { BrandProvider } from "@/lib/brand-store";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PortalSidebar } from "./portal-sidebar";
import { CommandPalette } from "./command-palette";

export function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <BrandProvider>
      <TooltipProvider delayDuration={200}>
        <div className="flex min-h-screen bg-background">
          <PortalSidebar />
          <main className="relative min-w-0 flex-1">
            <div className="mx-auto w-full max-w-6xl px-6 py-10 md:px-10 md:py-12">{children}</div>
          </main>
        </div>
        <CommandPalette />
      </TooltipProvider>
    </BrandProvider>
  );
}
