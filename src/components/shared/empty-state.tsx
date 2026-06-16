import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-dashed border-border px-8 py-16 text-center",
        className
      )}
    >
      {Icon && (
        <span className="mb-1 flex size-14 items-center justify-center rounded-[30%] bg-accent/10 text-accent">
          <Icon className="size-6" />
        </span>
      )}
      <h3 className="font-display text-lg font-medium tracking-tight">{title}</h3>
      {description && (
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
