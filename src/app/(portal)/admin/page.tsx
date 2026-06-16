import { redirect } from "next/navigation";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { KeyRound, Activity, Boxes, ArrowUpRight } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { getUsageRollup } from "@/lib/usage";
import { getConfiguredKeyNames, CONFIGURABLE_KEYS } from "@/lib/api-keys";
import { db, schema } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { BentoCard } from "@/components/ui/card";

export default async function AdminPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/dashboard");

  const [rollup, configured, brandCountRow] = await Promise.all([
    getUsageRollup(7).catch(() => null),
    getConfiguredKeyNames().catch(() => [] as string[]),
    db.select({ c: sql<number>`count(*)`.mapWith(Number) }).from(schema.brands).catch(() => [{ c: 0 }]),
  ]);
  const brandCount = brandCountRow[0]?.c ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Admin" title="Control room" description="API keys, spend, and system access — all in one place." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat icon={Activity} label="Spend · last 7 days" value={`$${(rollup?.total ?? 0).toFixed(2)}`} hint={`${rollup?.events ?? 0} calls`} />
        <Stat icon={KeyRound} label="Keys configured" value={`${configured.length}/${CONFIGURABLE_KEYS.length}`} />
        <Stat icon={Boxes} label="Brands" value={brandCount} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <LinkCard href="/admin/api-keys" icon={KeyRound} title="API Keys" desc="View, update, and revoke the keys every system uses. Changes take effect immediately." />
        <LinkCard href="/admin/usage" icon={Activity} title="Usage & Spend" desc="Cost by provider, system, brand, and key over time." />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; hint?: string }) {
  return (
    <BentoCard className="flex items-center gap-4 p-5">
      <span className="flex size-11 items-center justify-center rounded-[28%] bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <div>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-semibold tabular-nums">{value}</span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </BentoCard>
  );
}

function LinkCard({ href, icon: Icon, title, desc }: { href: string; icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <Link href={href} className="group block">
      <BentoCard interactive className="flex h-full items-start gap-4 p-6">
        <span className="flex size-11 items-center justify-center rounded-[28%] bg-accent/12 text-accent">
          <Icon className="size-5" />
        </span>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-medium tracking-tight">{title}</h3>
            <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{desc}</p>
        </div>
      </BentoCard>
    </Link>
  );
}
