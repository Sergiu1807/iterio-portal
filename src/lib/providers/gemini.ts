import "server-only";
import { getApiKey } from "@/lib/api-keys";
import { recordUsage, computeTokenCost } from "@/lib/usage";

const MODEL = "gemini-2.5-flash";

export type GeminiMedia = { base64: string; mimeType: string };
export type CallGeminiParams = {
  prompt: string;
  /** A single inline media part, or several (e.g. every card of a carousel). */
  media?: GeminiMedia | GeminiMedia[];
  maxOutputTokens?: number;
  systemKey?: string;
  brandId?: string;
};

/** Metered Gemini vision/text call — records token usage + cost. */
export async function callGemini(params: CallGeminiParams): Promise<string> {
  const key = await getApiKey("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not configured");

  const parts: Record<string, unknown>[] = [{ text: params.prompt }];
  if (params.media) {
    const items = Array.isArray(params.media) ? params.media : [params.media];
    for (const m of items) parts.push({ inlineData: { mimeType: m.mimeType, data: m.base64 } });
  }
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { temperature: 0.3, maxOutputTokens: params.maxOutputTokens ?? 1024 },
  });

  // Bounded retry with backoff on 429/5xx/network (raw REST has no built-in retry).
  let res: Response | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body,
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) break;
      if (res.status !== 429 && res.status < 500) break; // non-retryable
      lastErr = `Gemini ${res.status}`;
    } catch (e) {
      lastErr = String(e);
    }
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  if (!res || !res.ok) {
    throw new Error(res ? `Gemini ${res.status}: ${(await res.text()).slice(0, 200)}` : lastErr || "Gemini request failed");
  }
  const data = await res.json();
  const text: string =
    data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";

  const inT = data.usageMetadata?.promptTokenCount ?? 0;
  const outT = data.usageMetadata?.candidatesTokenCount ?? 0;
  await recordUsage({
    provider: "gemini",
    systemKey: params.systemKey,
    brandId: params.brandId,
    keyName: "GEMINI_API_KEY",
    model: MODEL,
    units: { inputTokens: inT, outputTokens: outT },
    costUsd: computeTokenCost(MODEL, inT, outT),
  });

  return text;
}
