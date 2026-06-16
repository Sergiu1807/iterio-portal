import { cn } from "@/lib/utils";
import { monogram, readableOn } from "@/lib/color";

/** A soft rounded monogram chip in the brand's color (no logo assets yet). */
export function BrandMark({
  name,
  color,
  size = 36,
  className,
}: {
  name: string;
  color: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[30%] font-display font-semibold leading-none",
        className
      )}
      style={{
        width: size,
        height: size,
        background: color,
        color: readableOn(color),
        fontSize: size * 0.4,
        boxShadow: "var(--inner-light), 0 2px 8px hsl(30 25% 35% / 0.18)",
      }}
      aria-hidden
    >
      {monogram(name)}
    </span>
  );
}
