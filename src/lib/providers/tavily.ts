import "server-only";
import { getApiKey } from "@/lib/api-keys";
import { recordUsage } from "@/lib/usage";

// Tavily bills per request (~$0.008 for an advanced search). Recorded as a flat
// per-search cost so Admin → Usage reflects discovery spend.
const ADVANCED_COST = 0.008;
const BASIC_COST = 0.005;

export type TavilyResult = { title: string; url: string; content: string };

export type TavilySearchParams = {
  query: string;
  searchDepth?: "basic" | "advanced";
  includeAnswer?: boolean;
  maxResults?: number;
  systemKey?: string;
  brandId?: string;
};

/** Metered Tavily web search — returns the synthesized answer + top results. */
export async function tavilySearch(params: TavilySearchParams): Promise<{ answer: string; results: TavilyResult[] }> {
  const key = await getApiKey("TAVILY_API_KEY");
  if (!key) throw new Error("TAVILY_API_KEY is not configured");

  const depth = params.searchDepth ?? "advanced";
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query: params.query,
      search_depth: depth,
      include_answer: params.includeAnswer ?? true,
      max_results: params.maxResults ?? 10,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { answer?: string; results?: { title?: string; url?: string; content?: string }[] };

  await recordUsage({
    provider: "tavily",
    systemKey: params.systemKey,
    brandId: params.brandId,
    keyName: "TAVILY_API_KEY",
    units: { searches: 1 },
    costUsd: depth === "advanced" ? ADVANCED_COST : BASIC_COST,
  });

  return {
    answer: typeof data.answer === "string" ? data.answer : "",
    results: Array.isArray(data.results)
      ? data.results.map((r) => ({ title: String(r.title ?? ""), url: String(r.url ?? ""), content: String(r.content ?? "") }))
      : [],
  };
}
