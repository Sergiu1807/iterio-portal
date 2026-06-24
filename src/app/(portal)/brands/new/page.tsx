"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import type { BrandDraft } from "@/lib/types";
import { useBrand } from "@/lib/brand-store";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { PathChooser, type OnboardPath } from "@/components/onboarding/path-chooser";
import { ResearchFlow } from "@/components/onboarding/research-flow";
import { PasteFlow } from "@/components/onboarding/paste-flow";
import { WizardFlow } from "@/components/onboarding/wizard-flow";
import { OnboardingReview } from "@/components/onboarding/review";

type Stage = "choose" | OnboardPath | "review";

const PATH_TITLE: Record<OnboardPath, string> = {
  research: "AI auto-research",
  paste: "Paste a doc",
  wizard: "Guided wizard",
};

export default function NewBrandPage() {
  const router = useRouter();
  const { addBrand } = useBrand();
  const [stage, setStage] = useState<Stage>("choose");
  const [draft, setDraft] = useState<BrandDraft | null>(null);

  const toReview = (d: BrandDraft) => {
    setDraft(d);
    setStage("review");
  };

  const create = async () => {
    if (!draft) return;
    try {
      const brand = await addBrand(draft);
      // The "research" path leads into the foundation workspace to build the B3;
      // paste/wizard already produced a populated brand → straight to the dashboard.
      if (draft.onboardingSource === "research") {
        toast.success(`${brand.name} created`, { description: "Let's build its Brand Intelligence." });
        router.push("/onboarding");
      } else {
        toast.success(`${brand.name} added`, { description: "Populated and ready across every system." });
        router.push("/dashboard");
      }
    } catch {
      toast.error("Couldn't create brand — try again.");
    }
  };

  const back = () => {
    if (stage === "review" && draft) setStage(draft.onboardingSource);
    else setStage("choose");
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Onboard"
        title={stage === "choose" ? "Add a brand" : stage === "review" ? "Review & create" : PATH_TITLE[stage as OnboardPath]}
        description={
          stage === "choose"
            ? "Pick how to bring this brand in. However you start, it ends up populated and instantly usable across every system."
            : stage === "review"
            ? "Final pass before it joins your workspace."
            : undefined
        }
        actions={
          stage !== "choose" ? (
            <Button variant="outline" onClick={back}>
              <ArrowLeft className="size-4" /> Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => router.push("/brands")}>
              Cancel
            </Button>
          )
        }
      />

      {stage === "choose" && <PathChooser onChoose={(p) => setStage(p)} />}
      {stage === "research" && <ResearchFlow onComplete={toReview} />}
      {stage === "paste" && <PasteFlow onComplete={toReview} />}
      {stage === "wizard" && <WizardFlow onComplete={toReview} />}
      {stage === "review" && draft && (
        <OnboardingReview draft={draft} onChange={setDraft} onConfirm={create} onBack={back} />
      )}
    </div>
  );
}
