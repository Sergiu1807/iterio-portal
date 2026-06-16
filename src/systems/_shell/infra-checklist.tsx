"use client";

import { Check, Circle } from "lucide-react";
import type { InfraRequirement } from "@/systems/types";
import { infraStatus } from "@/lib/infra";
import { usePortalMeta } from "@/lib/portal-meta";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<InfraRequirement["kind"], string> = {
  apiKey: "API key",
  service: "Service",
  n8n: "Workflow",
};

export function InfraChecklist({ infra }: { infra: InfraRequirement[] }) {
  const { configuredKeys } = usePortalMeta();
  if (infra.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Runs entirely in-app — no external services required.
      </p>
    );
  }
  const items = infraStatus(infra, configuredKeys);
  return (
    <ul className="space-y-2.5">
      {items.map(({ req, ready }, i) => (
        <li key={i} className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full",
              ready ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
            )}
          >
            {ready ? <Check className="size-3" /> : <Circle className="size-2 fill-current" />}
          </span>
          <span className="flex-1 text-sm">{req.label}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide",
              ready ? "bg-success/12 text-success" : "bg-muted text-muted-foreground"
            )}
          >
            {ready ? "Connected" : `${KIND_LABEL[req.kind]} needed`}
          </span>
        </li>
      ))}
    </ul>
  );
}
