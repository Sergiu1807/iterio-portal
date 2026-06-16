import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * BentoCard — the signature surface. Rounded, warm card with a soft layered
 * shadow + a top inner-light ("pressed into paper"). Optional hover lift and
 * grid span for asymmetric bento layouts.
 */
export interface BentoCardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  inset?: boolean;
}

const BentoCard = React.forwardRef<HTMLDivElement, BentoCardProps>(
  ({ className, interactive, inset = true, ...props }, ref) => (
    <div
      ref={ref}
      style={inset ? { boxShadow: "var(--shadow-card), var(--inner-light)" } : undefined}
      className={cn(
        "rounded-[var(--radius)] border border-border/70 bg-card text-card-foreground",
        !inset && "shadow-card",
        interactive &&
          "transition-all duration-300 hover:-translate-y-0.5 hover:border-border cursor-pointer",
        className
      )}
      {...props}
    />
  )
);
BentoCard.displayName = "BentoCard";

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("font-display text-lg font-medium tracking-tight", className)} {...props} />
  );
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground leading-relaxed", className)} {...props} />;
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-3 p-6 pt-0", className)} {...props} />;
}

export { BentoCard, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
