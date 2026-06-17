import "server-only";
import { submitSeedanceVideo, pollKieJob, SEEDANCE_VIDEO_MODEL } from "./kie";

/**
 * Video-provider seam. Today only Kie Seedance 2 is wired; the indirection lets
 * us drop in other providers (MUAPI, fal, …) later without touching callers —
 * switch on VIDEO_PROVIDER (default "kie").
 */
function provider(): string {
  return (process.env.VIDEO_PROVIDER || "kie").trim().replace(/^["']|["']$/g, "").toLowerCase();
}

/** The model id recorded for usage/metering of the active provider. */
export function videoModelId(): string {
  return SEEDANCE_VIDEO_MODEL;
}

export type VideoJobParams = {
  prompt: string;
  imageUrls: string[];
  aspectRatio: string;
  duration: number;
  resolution?: string;
};

/** Submit a video job to the active provider; returns the provider task id. */
export async function submitVideoJob(params: VideoJobParams): Promise<string> {
  switch (provider()) {
    // case "muapi": return submitMuapiVideo(params);  // future
    default:
      return submitSeedanceVideo(params);
  }
}

export type VideoPollResult = { state: "pending" | "processing" | "success" | "failed"; videoUrl?: string; errorMessage?: string };

/** Poll a video job on the active provider. Kie shares the recordInfo endpoint. */
export async function pollVideoJob(taskId: string): Promise<VideoPollResult> {
  const r = await pollKieJob(taskId);
  return { state: r.state, videoUrl: r.resultUrls[0], errorMessage: r.errorMessage };
}
