"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { PackageX } from "lucide-react";
import { getSystem } from "@/systems/registry";
import { useBrand } from "@/lib/brand-store";
import { PlaceholderState } from "@/systems/_shell/placeholder-state";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function SystemPage() {
  const params = useParams();
  const key = String(params.systemKey ?? "");
  const system = getSystem(key);
  const { currentBrandId } = useBrand();

  if (!system) {
    return (
      <EmptyState
        icon={PackageX}
        title="Unknown system"
        description={`No system is registered under "${key}".`}
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
    );
  }

  // When a system flips to "live", its Component mounts here — no shell changes.
  if (system.status === "live" && system.Component && currentBrandId) {
    const Live = system.Component;
    return (
      <Suspense fallback={<div className="h-64 animate-pulse rounded-[var(--radius)] bg-muted/50" />}>
        <Live brandId={currentBrandId} />
      </Suspense>
    );
  }

  return <PlaceholderState system={system} />;
}
