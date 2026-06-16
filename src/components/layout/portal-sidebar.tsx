"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Building2, BookOpen, Sparkles, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { systemsByGroup } from "@/systems/registry";
import { NAV_GROUP_LABELS } from "@/systems/types";
import { allInfraReady } from "@/lib/infra";
import { usePortalMeta } from "@/lib/portal-meta";
import { BrandSwitcher } from "./brand-switcher";
import { ThemeToggle } from "./theme-toggle";

const BASE_NAV = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Brands", href: "/brands", icon: Building2 },
  { name: "Brand Intelligence", href: "/brand-intelligence", icon: BookOpen },
];

export function PortalSidebar() {
  const pathname = usePathname();
  const groups = systemsByGroup();
  const { role, configuredKeys } = usePortalMeta();

  const isActive = (href: string) =>
    href === pathname || (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <aside className="sticky top-0 flex h-screen w-[268px] shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* wordmark */}
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-6">
        <span className="flex size-8 items-center justify-center rounded-[28%] bg-sidebar-active/90 text-[hsl(150_14%_12%)]">
          <Sparkles className="size-4" />
        </span>
        <span className="font-display text-[17px] font-semibold tracking-tight">Iterio Portal</span>
      </div>

      <div className="px-4 pb-3">
        <BrandSwitcher />
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-3">
        <div className="space-y-0.5">
          {BASE_NAV.map((item) => (
            <NavLink key={item.href} href={item.href} active={isActive(item.href)} icon={item.icon}>
              {item.name}
            </NavLink>
          ))}
          {role === "admin" && (
            <NavLink href="/admin" active={isActive("/admin")} icon={ShieldCheck}>
              Admin
            </NavLink>
          )}
        </div>

        {groups.map(({ group, systems }) => (
          <div key={group} className="space-y-0.5">
            <p className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-sidebar-muted">
              {NAV_GROUP_LABELS[group]}
            </p>
            {systems.map((s) => {
              const ready = allInfraReady(s.infra, configuredKeys);
              return (
                <NavLink
                  key={s.key}
                  href={`/s/${s.key}`}
                  active={pathname === `/s/${s.key}`}
                  icon={s.icon}
                  iconColor={s.accent}
                >
                  <span className="flex-1 truncate">{s.name}</span>
                  {s.status === "placeholder" ? (
                    <span
                      className="ml-auto rounded-full bg-sidebar-surface px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sidebar-muted"
                      title="Coming soon"
                    >
                      soon
                    </span>
                  ) : !ready ? (
                    <span className="ml-auto size-1.5 rounded-full bg-amber-400" title="Needs setup" />
                  ) : null}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-between border-t border-sidebar-border/60 px-4 py-3">
        <span className="flex items-center gap-1.5 text-[11px] text-sidebar-muted">
          <kbd className="rounded-md border border-sidebar-border bg-sidebar-surface px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
          to search
        </span>
        <ThemeToggle />
      </div>
    </aside>
  );
}

function NavLink({
  href,
  active,
  icon: Icon,
  iconColor,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  iconColor?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors",
        active
          ? "bg-sidebar-surface text-sidebar-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-surface/60 hover:text-sidebar-foreground"
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-sidebar-active transition-opacity",
          active ? "opacity-100" : "opacity-0"
        )}
      />
      <Icon
        className={cn("size-[18px] shrink-0", !iconColor && "text-current")}
        style={iconColor && active ? { color: iconColor } : iconColor ? { color: iconColor, opacity: 0.85 } : undefined}
      />
      {children}
    </Link>
  );
}
