import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SYSTEM_KEY } from "./constants";
import { generateAnglesForBatch } from "./generate";

const MAX_ATTEMPTS = 3;

type BatchRow = typeof schema.angleBatches.$inferSelect;

function isTransient(e: unknown): boolean {
  if (e instanceof Anthropic.APIError) { const s = e.status ?? 0; return s === 429 || s >= 500; }
  return /connection error|fetch failed|econnreset|etimedout|socket|network|timed out|overloaded/i.test(String((e as { message?: string })?.message ?? e));
}

const setBatch = (id: string, patch: Partial<BatchRow>) =>
  db.update(schema.angleBatches).set({ ...patch, updatedAt: new Date() }).where(eq(schema.angleBatches.id, id));

/** Atomic-claim + run pending batches (mirrors brand-foundation/pipeline claimAndRunExtract). */
async function claimAndRun(brandId?: string, limit = 3): Promise<number> {
  const brandFilter = brandId ? sql`AND brand_id = ${brandId}` : sql``;
  const claimed = await db.execute(sql`
    UPDATE angle_batches SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM angle_batches
      WHERE status = 'pending' AND attempts < ${MAX_ATTEMPTS} ${brandFilter}
      ORDER BY created_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING id`);
  const ids = (claimed as unknown as { id: string }[]).map((r) => r.id);
  if (!ids.length) return 0;

  const batches = await db.select().from(schema.angleBatches).where(inArray(schema.angleBatches.id, ids));
  for (const batch of batches) {
    const t0 = new Date();
    try {
      const { angles, groundingSource, b3Version } = await generateAnglesForBatch(batch);

      // Guarded finalize: only the writer that still sees 'running' completes + writes angles.
      const done = await db
        .update(schema.angleBatches)
        .set({ status: "complete", completedAt: new Date(), groundingSource, b3Version, updatedAt: new Date() })
        .where(and(eq(schema.angleBatches.id, batch.id), eq(schema.angleBatches.status, "running")))
        .returning({ id: schema.angleBatches.id });
      if (!done.length) continue; // swept/finalized elsewhere — don't double-write

      if (angles.length) await db.insert(schema.angles).values(angles.map((a) => ({ ...a, batchId: batch.id, brandId: batch.brandId })));

      // Attribute this batch's Claude spend (runs sequentially → clean window).
      const [{ c }] = await db
        .select({ c: sql<number>`coalesce(sum(${schema.usageEvents.costUsd}),0)`.mapWith(Number) })
        .from(schema.usageEvents)
        .where(and(eq(schema.usageEvents.systemKey, SYSTEM_KEY), eq(schema.usageEvents.brandId, batch.brandId), gte(schema.usageEvents.createdAt, t0)));
      await setBatch(batch.id, { costCents: Math.round((c ?? 0) * 100) });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      if (isTransient(e)) {
        await setBatch(batch.id, { status: "pending", attempts: Math.max(0, batch.attempts - 1), errorMessage: msg }); // requeue, don't burn
      } else {
        const exhausted = batch.attempts >= MAX_ATTEMPTS;
        await setBatch(batch.id, { status: exhausted ? "failed" : "pending", errorMessage: msg });
      }
    }
  }
  return batches.length;
}

/** UI-driven advance for one brand (mirrors the other systems' tick). */
export async function runIdeationTick(brandId: string): Promise<number> {
  return claimAndRun(brandId, 2);
}

/** Cron backstop across all brands. */
export async function runIdeationCron(): Promise<number> {
  const advanced = await claimAndRun(undefined, 6);
  await sweepStuck();
  return advanced;
}

/** Stuck running/pending batches > 30 min → failed. */
export async function sweepStuck(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  await db
    .update(schema.angleBatches)
    .set({ status: "failed", errorMessage: "Timed out (sweep)", updatedAt: new Date() })
    .where(and(inArray(schema.angleBatches.status, ["pending", "running"]), lt(schema.angleBatches.updatedAt, cutoff)));
}
