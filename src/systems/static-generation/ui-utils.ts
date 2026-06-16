import type { Generation } from "./ui-types";

export const ACTIVE_STATUSES = ["pending", "generating"];

export function isActive(g: Generation): boolean {
  return ACTIVE_STATUSES.includes(g.status);
}

/** Tailwind aspect-ratio class for a tile. */
export function aspectClass(ratio: string): string {
  switch (ratio) {
    case "9:16":
      return "aspect-[9/16]";
    case "4:5":
      return "aspect-[4/5]";
    case "16:9":
      return "aspect-[16/9]";
    default:
      return "aspect-square";
  }
}

export function modeLabel(mode: string): string {
  switch (mode) {
    case "brief":
      return "Brief";
    case "refined":
      return "Refined";
    case "edited":
      return "Edited";
    default:
      return "Custom";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "generating":
      return "Generating";
    case "completed":
      return "Done";
    case "error":
      return "Failed";
    default:
      return status;
  }
}
