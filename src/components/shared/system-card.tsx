import Link from "next/link";
import { ArrowUpRight, Check, Lock } from "lucide-react";
import type { SystemDefinition } from "@/systems/types";
import { allInfraReady, infraStatus } from "@/lib/infra";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function SystemCard({
  system,
  enabled,
}: {
  system: SystemDefinition;
  enabled: boolean;
}) {
  const ready = allInfraReady(system.infra);
  const missing = infraStatus(system.infra).filter((s) => !s.ready);
  const Icon = system.icon;

  return (
    <Link href={`/s/${system.key}`} className="group block h-full">
      <BentoCard interactive className="relative flex h-full flex-col overflow-hidden p-6">
        {/* accent wash */}
        <div
          className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full opacity-[0.13] blur-2xl transition-opacity group-hover:opacity-25"
          style={{ background: system.accent }}
        />

        <div className="mb-4 flex items-start justify-between">
          <span
            className="flex size-11 items-center justify-center rounded-[28%]"
            style={{ background: `${system.accent}1f`, color: system.accent }}
          >
            <Icon className="size-5" />
          </span>
          <div className="flex items-center gap-2">
            {system.status === "placeholder" ? (
              <Badge variant="soon">Coming soon</Badge>
            ) : (
              <Badge variant="success">
                <Check className="size-3" /> Live
              </Badge>
            )}
          </div>
        </div>

        <h3 className="font-display text-[19px] font-medium tracking-tight">{system.name}</h3>
        <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{system.tagline}</p>

        <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4">
          {!enabled ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5" /> Off for this brand
            </span>
          ) : !ready ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
              <span className="size-1.5 rounded-full bg-warning" />
              Needs {missing.map((m) => m.req.label.split(" ")[0]).join(", ")}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" /> Ready to configure
            </span>
          )}
          <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
        </div>
      </BentoCard>
    </Link>
  );
}
