import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { tavilySearch } from "@/lib/providers/tavily";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { startScrapeJob } from "./scrape-job";
import { isAdLibraryUrl } from "./meta-url";

const SYSTEM_KEY = "competitor-research";
const MAX_COMPETITORS = 12;

type Competitor = { name: string; domain?: string; metaPageUrl?: string };
type Discovered = { niche: string; competitors: Competitor[] };

const DISCOVER_TOOL: Anthropic.Tool = {
  name: "emit_competitors",
  description: "Return the seed brand's niche and its direct competitors.",
  input_schema: {
    type: "object",
    properties: {
      niche: { type: "string", description: "The brand's product category / niche, e.g. 'collagen supplements'." },
      competitors: {
        type: "array",
        description: "8-12 DIRECT competitor brands in the same product category. Exclude retailers, marketplaces, publishers, and the seed brand itself.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Brand name." },
            domain: { type: "string", description: "Primary website domain, e.g. vitalproteins.com (no protocol)." },
            metaPageUrl: { type: "string", description: "Meta Ad Library URL if explicitly known, else omit." },
          },
          required: ["name"],
        },
      },
    },
    required: ["niche", "competitors"],
  },
};

const norm = (s: string) => s.trim().toLowerCase();
const cleanDomain = (d?: string) => (d ? d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase() : "");

/** Web research (Tavily) → structured competitor list (Claude). */
export async function discoverCompetitors(input: string, brandId: string): Promise<Discovered> {
  const query =
    `Direct competitor brands to "${input}". List rival DTC companies in the same product category/niche ` +
    `that run ads on Meta (Facebook/Instagram). For each, give the brand name and its website domain.`;
  const tav = await tavilySearch({ query, searchDepth: "advanced", includeAnswer: true, maxResults: 10, systemKey: SYSTEM_KEY, brandId });

  const context = [
    tav.answer ? `RESEARCH SUMMARY:\n${tav.answer}` : "",
    "SOURCES:",
    ...tav.results.map((r) => `- ${r.title} (${r.url}): ${r.content}`),
  ]
    .join("\n")
    .slice(0, 9000);

  const resp = await callClaude({
    model: "claude-sonnet-4-6",
    maxTokens: 1200,
    system:
      "You identify a brand's niche and its DIRECT competitors from web research. Return 8-12 real, distinct, direct competitors (same product category and similar positioning) — never retailers, marketplaces, publishers, or the seed brand itself. Prefer brands that advertise to consumers.",
    messages: [{ role: "user", content: `Seed brand / input: ${input}\n\n${context}\n\nReturn the niche + 8-12 direct competitors via the emit_competitors tool.` }],
    tools: [DISCOVER_TOOL],
    toolChoice: { type: "tool", name: "emit_competitors" },
    systemKey: SYSTEM_KEY,
    brandId,
  });

  const out = toolResult<Discovered>(resp, "emit_competitors");
  if (!out || !Array.isArray(out.competitors)) throw new Error("discovery returned no competitors");
  return { niche: out.niche ?? "", competitors: out.competitors };
}

export type DiscoveryResult = {
  niche: string;
  competitors: { name: string; scraped: boolean }[];
  jobsStarted: number;
};

/**
 * One brand in → discover its competitor set → persist (deduped, with niche) →
 * fan out one Ad Library scrape per competitor (valid Meta URL, else keyword by
 * name). The existing poll/ingest/analyze/score pipeline harvests them from there.
 */
export async function runDiscovery(brandId: string, input: string, requestedCount: number): Promise<DiscoveryResult> {
  const { niche, competitors } = await discoverCompetitors(input, brandId);

  // dedupe the model's list by name + domain, cap the count
  const seen = new Set<string>();
  const list: Competitor[] = [];
  for (const c of competitors) {
    const nameKey = norm(c.name ?? "");
    const domKey = cleanDomain(c.domain);
    if (!nameKey || nameKey === norm(input)) continue;
    if (seen.has(nameKey) || (domKey && seen.has(domKey))) continue;
    seen.add(nameKey);
    if (domKey) seen.add(domKey);
    list.push(c);
    if (list.length >= MAX_COMPETITORS) break;
  }

  // existing competitors for this brand → reuse rather than duplicate
  const existing = await db
    .select({ id: schema.competitors.id, name: schema.competitors.name, metaLibraryUrl: schema.competitors.metaLibraryUrl })
    .from(schema.competitors)
    .where(eq(schema.competitors.brandId, brandId));
  const byName = new Map(existing.map((e) => [norm(e.name), e]));

  // process each competitor in parallel (distinct rows, independent scrapes)
  const settled = await Promise.allSettled(
    list.map(async (c) => {
      const ex = byName.get(norm(c.name));
      let competitorId: string;
      let metaLibraryUrl: string | null;
      if (ex) {
        competitorId = ex.id;
        metaLibraryUrl = ex.metaLibraryUrl;
      } else {
        const validMeta = c.metaPageUrl && isAdLibraryUrl(c.metaPageUrl) ? c.metaPageUrl : null;
        const dom = cleanDomain(c.domain);
        const [row] = await db
          .insert(schema.competitors)
          .values({
            brandId,
            name: c.name.trim(),
            websiteUrl: dom ? `https://${dom}` : null,
            metaLibraryUrl: validMeta,
            niche: niche || null,
            type: "Direct",
            country: "ALL",
          })
          .returning({ id: schema.competitors.id });
        competitorId = row.id;
        metaLibraryUrl = validMeta;
      }

      // prefer a known Ad Library URL; otherwise keyword-search the Ad Library by name
      if (metaLibraryUrl && isAdLibraryUrl(metaLibraryUrl)) {
        await startScrapeJob({ brandId, mode: "url", query: metaLibraryUrl, requestedCount, competitorId, niche });
      } else {
        await startScrapeJob({ brandId, mode: "keyword", query: c.name.trim(), requestedCount, competitorId, niche });
      }
      return c.name;
    })
  );

  const results = list.map((c, i) => ({ name: c.name, scraped: settled[i].status === "fulfilled" }));
  return { niche, competitors: results, jobsStarted: results.filter((r) => r.scraped).length };
}
