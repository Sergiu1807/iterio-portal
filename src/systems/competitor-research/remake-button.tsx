"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wand2, Loader2, Image as ImageIcon, Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { Concept } from "./ui-types";

/** sessionStorage key the Static/Video Create forms read to pre-fill themselves. */
export const REMAKE_PREFILL_KEY = "iterio:remake-prefill";

/** Remake → prepare the on-brand inputs server-side, hand them to the target
 *  system's Create form (via sessionStorage), and navigate there. The user lands
 *  on a pre-filled form and just presses Generate. */
export function RemakeButton({ concept, brandId }: { concept: Concept; brandId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"static" | "video" | null>(null);

  const go = async (target: "static" | "video") => {
    setBusy(target);
    const res = await fetch("/api/systems/competitor-research/remake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, conceptId: concept.id, target }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(null);
      toast.error(data?.error ?? "Couldn't prepare the remake");
      return;
    }
    try {
      sessionStorage.setItem(REMAKE_PREFILL_KEY, JSON.stringify(data));
    } catch {
      /* ignore quota / disabled storage */
    }
    if (data.compliance?.pass === false && Array.isArray(data.compliance.failures) && data.compliance.failures.length) {
      toast.warning("Compliance flags to review", { description: data.compliance.failures.slice(0, 3).join(" · ") });
    }
    router.push(`/s/${target === "video" ? "video-generation" : "static-generation"}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="cta-glow" disabled={!!busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} Remake
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => go("static")} disabled={!!busy}>
          <ImageIcon className="size-4" /> Open in Static
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => go("video")} disabled={!!busy}>
          <Clapperboard className="size-4" /> Open in Video
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
