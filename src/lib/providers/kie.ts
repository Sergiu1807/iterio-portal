import "server-only";
import { getApiKey } from "@/lib/api-keys";
import { recordUsage, computeImageCost } from "@/lib/usage";

/**
 * Kie AI image client for the Static Ad system.
 *   Create task: POST /api/v1/jobs/createTask
 *   Poll task:   GET  /api/v1/jobs/recordInfo?taskId=...
 *
 * Two models:
 *   - nano-banana-2              → primary generation (text + reference/product/logo image inputs)
 *   - gpt-image-2-image-to-image → the manual "refine product" / "refine logo" / edit passes
 */

const KIE_API_BASE = "https://api.kie.ai/api/v1/jobs";

export const NANO_BANANA_MODEL = "nano-banana-2";
export const GPT_IMAGE_2_MODEL = "gpt-image-2-image-to-image";

/** Fixed refine prompts (ported from the proven portal flow). */
export const REFINE_PROMPT_PRODUCT =
  "Keep everything the same, swap the product to the product image attached.";
export const REFINE_PROMPT_LOGO =
  "Keep everything in the canvas exactly the same — composition, layout, copy, colors, and any product or UI mockup must all remain unchanged. The ONLY change: replace any brand wordmark or logo visible on the canvas with the brand logo image provided as the second input. Match its proportions, color, and typography exactly. Do not alter, restyle, or reposition anything else.";

async function kieKey(): Promise<string> {
  const key = await getApiKey("KIE_AI_API_KEY");
  if (!key) throw new Error("KIE_AI_API_KEY is not configured");
  return key;
}

export type KiePollResult = {
  state: "pending" | "processing" | "success" | "failed";
  resultUrls: string[];
  errorMessage?: string;
  costTime?: number;
};

async function createTask(body: Record<string, unknown>): Promise<string> {
  const apiKey = await kieKey();
  const res = await fetch(`${KIE_API_BASE}/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Kie createTask failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.code !== 200 && json.code !== 0) {
    throw new Error(`Kie createTask error: ${json.msg || JSON.stringify(json).slice(0, 200)}`);
  }
  const taskId = json.data?.taskId ?? json.taskId;
  if (!taskId) throw new Error(`Kie createTask: no taskId in response: ${JSON.stringify(json).slice(0, 200)}`);
  return taskId as string;
}

/** Submit a nano-banana-2 generation. `imageUrls` are publicly-fetchable URLs (up to 14). */
export async function submitNanoBanana(params: {
  prompt: string;
  imageUrls: string[];
  aspectRatio?: string;
  resolution?: string;
  outputFormat?: string;
}): Promise<string> {
  return createTask({
    model: NANO_BANANA_MODEL,
    input: {
      prompt: params.prompt,
      image_input: params.imageUrls,
      aspect_ratio: params.aspectRatio || "auto",
      resolution: params.resolution || "2K",
      output_format: params.outputFormat || "png",
    },
  });
}

/** Aspect ratios GPT Image 2 supports directly (per Kie docs). */
const GPT2_SUPPORTED_RATIOS = new Set(["1:1", "9:16", "16:9", "4:3", "3:4"]);

/** Map our broader aspect-ratio set onto GPT Image 2's supported subset. */
export function mapAspectForGpt2(ratio: string | null | undefined): string {
  if (!ratio) return "auto";
  if (GPT2_SUPPORTED_RATIOS.has(ratio)) return ratio;
  switch (ratio) {
    case "4:5":
    case "2:3":
      return "3:4";
    case "5:4":
    case "3:2":
      return "4:3";
    case "21:9":
      return "16:9";
    default:
      return "auto";
  }
}

/** Submit a gpt-image-2-image-to-image refine/edit. `inputUrls` are publicly-fetchable (up to 16). */
export async function submitGptImage2(params: {
  prompt: string;
  inputUrls: string[];
  aspectRatio?: string;
  resolution?: string;
}): Promise<string> {
  const aspectRatio = mapAspectForGpt2(params.aspectRatio);
  // Per Kie docs: "auto" aspect caps to 1K; 1:1 cannot use 4K.
  let resolution = params.resolution || (aspectRatio === "auto" ? "1K" : "2K");
  if (aspectRatio === "auto" && resolution !== "1K") resolution = "1K";
  if (aspectRatio === "1:1" && resolution === "4K") resolution = "2K";
  return createTask({
    model: GPT_IMAGE_2_MODEL,
    input: { prompt: params.prompt, input_urls: params.inputUrls, aspect_ratio: aspectRatio, resolution },
  });
}

export async function pollKieJob(taskId: string): Promise<KiePollResult> {
  const apiKey = await kieKey();
  const res = await fetch(`${KIE_API_BASE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Kie recordInfo failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const data = json.data || {};

  let resultUrls: string[] = [];
  if (data.resultJson) {
    try {
      const parsed = typeof data.resultJson === "string" ? JSON.parse(data.resultJson) : data.resultJson;
      resultUrls = parsed.resultUrls || [];
    } catch {
      /* resultJson not valid JSON yet */
    }
  }

  const stateMap: Record<string, KiePollResult["state"]> = {
    success: "success",
    failed: "failed",
    fail: "failed",
    pending: "pending",
    processing: "processing",
    running: "processing",
    queued: "pending",
  };
  return {
    state: stateMap[(data.state as string) || "pending"] || "processing",
    resultUrls,
    errorMessage: data.failMsg || undefined,
    costTime: data.costTime || undefined,
  };
}

/** Record one finished image into usage_events (estimated cost — Kie bills separately). */
export async function recordKieImageUsage(args: {
  model: string;
  resolution?: string;
  systemKey?: string;
  brandId?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await recordUsage({
    provider: "kie",
    systemKey: args.systemKey,
    brandId: args.brandId,
    keyName: "KIE_AI_API_KEY",
    model: args.model,
    units: { images: 1 },
    costUsd: computeImageCost(args.model, args.resolution),
    meta: args.meta,
  });
}
