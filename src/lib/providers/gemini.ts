import "server-only";
import { getApiKey } from "@/lib/api-keys";
import { recordUsage, computeTokenCost } from "@/lib/usage";

const MODEL = "gemini-2.5-flash";

export type CallGeminiParams = {
  prompt: string;
  media?: { base64: string; mimeType: string };
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
    parts.push({ inlineData: { mimeType: params.media.mimeType, data: params.media.base64 } });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.3, maxOutputTokens: params.maxOutputTokens ?? 1024 },
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
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
