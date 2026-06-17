import "server-only";
import { gte, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";

// Per-million token pricing (USD). Apify cost is taken from the run object, not here.
const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 15, output: 75 },
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
};
const DEFAULT_PRICE = { input: 3, output: 15 };

export function computeTokenCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICE_PER_MILLION[model] ?? DEFAULT_PRICE;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

// Per-image price estimates (USD) for Kie AI image models. Kie bills separately;
// these are best-effort estimates so Admin → Usage reflects image spend.
const IMAGE_PRICE: Record<string, Record<string, number>> = {
  "nano-banana-2": { "1K": 0.015, "2K": 0.02, "4K": 0.04 },
  "gpt-image-2-image-to-image": { "1K": 0.03, "2K": 0.05, "4K": 0.08 },
};

export function computeImageCost(model: string, resolution = "2K"): number {
  const m = IMAGE_PRICE[model];
  return m?.[resolution] ?? m?.["2K"] ?? 0.02;
}

// Per-video price estimates (USD) by model + duration (seconds). Kie bills
// separately; these are best-effort so Admin → Usage reflects video spend.
const VIDEO_PRICE: Record<string, Record<number, number>> = {
  "bytedance/seedance-2": { 5: 0.25, 10: 0.5, 15: 0.75 },
};

export function computeVideoCost(model: string, duration = 10): number {
  const m = VIDEO_PRICE[model];
  return m?.[duration] ?? m?.[10] ?? 0.5;
}

export type UsageProvider = "anthropic" | "gemini" | "apify" | "kie";

export type UsageEvent = {
  provider: UsageProvider;
  systemKey?: string | null;
  brandId?: string | null;
  keyName?: string | null;
  model?: string | null;
  units?: Record<string, number>;
  costUsd: number;
  meta?: Record<string, unknown>;
};

/** Best-effort — never throws into the caller's pipeline. */
export async function recordUsage(e: UsageEvent): Promise<void> {
  try {
    await db.insert(schema.usageEvents).values({
      provider: e.provider,
      systemKey: e.systemKey ?? null,
      brandId: e.brandId ?? null,
      keyName: e.keyName ?? null,
      model: e.model ?? null,
      units: e.units ?? {},
      costUsd: (e.costUsd ?? 0).toFixed(6),
      meta: e.meta ?? null,
    });
  } catch (err) {
    console.warn("[usage] failed to record:", err);
  }
}

export type Rollup = {
  total: number;
  events: number;
  byProvider: { key: string; cost: number; events: number }[];
  bySystem: { key: string; cost: number; events: number }[];
  byKey: { key: string; cost: number; events: number }[];
  byBrand: { key: string; cost: number; events: number }[];
};

export async function getUsageRollup(windowDays: number): Promise<Rollup> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const cost = sql<number>`coalesce(sum(${schema.usageEvents.costUsd}), 0)`.mapWith(Number);
  const events = sql<number>`count(*)`.mapWith(Number);

  const group = async (col: PgColumn) =>
    db
      .select({ key: col, cost, events })
      .from(schema.usageEvents)
      .where(gte(schema.usageEvents.createdAt, since))
      .groupBy(col);

  const [providerRows, systemRows, keyRows, brandRows, totals] = await Promise.all([
    group(schema.usageEvents.provider),
    group(schema.usageEvents.systemKey),
    group(schema.usageEvents.keyName),
    group(schema.usageEvents.brandId),
    db.select({ cost, events }).from(schema.usageEvents).where(gte(schema.usageEvents.createdAt, since)),
  ]);

  const norm = (rows: { key: string | null; cost: number; events: number }[]) =>
    rows
      .map((r) => ({ key: r.key ?? "—", cost: Number(r.cost), events: Number(r.events) }))
      .sort((a, b) => b.cost - a.cost);

  return {
    total: Number(totals[0]?.cost ?? 0),
    events: Number(totals[0]?.events ?? 0),
    byProvider: norm(providerRows),
    bySystem: norm(systemRows),
    byKey: norm(keyRows),
    byBrand: norm(brandRows),
  };
}
