import type { VideoGen } from "./ui-types";
import { AROLL_STYLES } from "./constants";

export const ACTIVE_STATUSES = ["pending", "generating"];

export function isActive(g: VideoGen): boolean {
  return ACTIVE_STATUSES.includes(g.status);
}

export function videoAspectClass(ratio: string): string {
  switch (ratio) {
    case "9:16":
      return "aspect-[9/16]";
    case "16:9":
      return "aspect-video";
    case "4:5":
      return "aspect-[4/5]";
    case "4:3":
      return "aspect-[4/3]";
    default:
      return "aspect-square";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "generating":
      return "Rendering";
    case "completed":
      return "Done";
    case "error":
      return "Failed";
    default:
      return status;
  }
}

export function modeLabel(g: { videoType: string; arollStyle: string | null }): string {
  if (g.videoType === "broll") return "B-Roll";
  if (g.videoType === "aroll") {
    const s = AROLL_STYLES.find((x) => x.value === g.arollStyle)?.label;
    return s ? `A-Roll · ${s}` : "A-Roll";
  }
  return "UGC";
}

export const durationLabel = (d: number) => `${d}s`;
