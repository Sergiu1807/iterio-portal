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

export type Candidate = { name: string; domain?: string; metaPageUrl?: string; hasMetaUrl: boolean };

/** Phase 1 — return the candidate competitor set for review. No persistence, no scraping. */
export async function discoverCandidates(input: string, brandId: string): Promise<{ niche: string; candidates: Candidate[] }> {
  const { niche, competitors } = await discoverCompetitors(input, brandId);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const c of competitors) {
    const nameKey = norm(c.name ?? "");
    const domKey = cleanDomain(c.domain);
    if (!nameKey || nameKey === norm(input)) continue;
    if (seen.has(nameKey) || (domKey && seen.has(domKey))) continue;
    seen.add(nameKey);
    if (domKey) seen.add(domKey);
    const validMeta = c.metaPageUrl && isAdLibraryUrl(c.metaPageUrl) ? c.metaPageUrl : undefined;
    candidates.push({ name: c.name.trim(), domain: domKey || undefined, metaPageUrl: validMeta, hasMetaUrl: !!validMeta });
    if (candidates.length >= MAX_COMPETITORS) break;
  }
  return { niche, candidates };
}

export type SelectedCompetitor = { name: string; domain?: string; metaPageUrl?: string; count?: number };
export type DiscoveryResult = { competitors: { name: string; scraped: boolean }[]; jobsStarted: number };

/**
 * Phase 2 — persist the chosen competitors (deduped, with niche) and fan out one
 * Ad Library scrape each (valid Meta URL, else keyword by name) at the per-
 * competitor ad count. The existing poll/ingest/analyze/score pipeline harvests them.
 */
export async function scrapeSelectedCompetitors(brandId: string, niche: string, selected: SelectedCompetitor[]): Promise<DiscoveryResult> {
  const seen = new Set<string>();
  const list = selected
    .filter((c) => {
      const k = norm(c.name ?? "");
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_COMPETITORS);

  const existing = await db
    .select({ id: schema.competitors.id, name: schema.competitors.name, metaLibraryUrl: schema.competitors.metaLibraryUrl })
    .from(schema.competitors)
    .where(eq(schema.competitors.brandId, brandId));
  const byName = new Map(existing.map((e) => [norm(e.name), e]));

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

      const requestedCount = Math.min(100, Math.max(1, c.count || 20));
      if (metaLibraryUrl && isAdLibraryUrl(metaLibraryUrl)) {
        await startScrapeJob({ brandId, mode: "url", query: metaLibraryUrl, requestedCount, competitorId, niche });
      } else {
        await startScrapeJob({ brandId, mode: "keyword", query: c.name.trim(), requestedCount, competitorId, niche });
      }
      return c.name;
    })
  );

  const results = list.map((c, i) => ({ name: c.name, scraped: settled[i].status === "fulfilled" }));
  return { competitors: results, jobsStarted: results.filter((r) => r.scraped).length };
}
