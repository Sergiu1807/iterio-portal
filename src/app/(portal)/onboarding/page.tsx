"use client";

import Link from "next/link";
import { Compass } from "lucide-react";
import { useBrand } from "@/lib/brand-store";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import OnboardingWorkspace from "@/systems/brand-foundation/workspace";

export default function OnboardingPage() {
  const { currentBrand, isReady } = useBrand();
  if (!isReady) return null;
  if (!currentBrand) {
    return (
      <EmptyState
        icon={Compass}
        title="Create a brand first"
        description="Onboarding builds a brand's foundation (Brand Intelligence). Add a brand to begin."
        action={<Button asChild><Link href="/brands/new">Add a brand</Link></Button>}
      />
    );
  }
  return <OnboardingWorkspace brandId={currentBrand.id} />;
}
