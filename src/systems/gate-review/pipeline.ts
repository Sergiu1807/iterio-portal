import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SYSTEM_KEY } from "./constants";
import { runGateReview } from "./generate";

const MAX_ATTEMPTS = 3;
type ReviewRow = typeof schema.gateReviews.$inferSelect;

function isTransient(e: unknown): boolean {
  if (e instanceof Anthropic.APIError) { const s = e.status ?? 0; return s === 429 || s >= 500; }
  return /connection error|fetch failed|econnreset|etimedout|socket|network|timed out|overloaded|gemini \d/i.test(String((e as { message?: string })?.message ?? e));
}
const setReview = (id: string, patch: Partial<ReviewRow>) => db.update(schema.gateReviews).set({ ...patch, updatedAt: new Date() }).where(eq(schema.gateReviews.id, id));

async function claimAndRun(brandId?: string, limit = 3): Promise<number> {
  const brandFilter = brandId ? sql`AND brand_id = ${brandId}` : sql``;
  const claimed = await db.execute(sql`
    UPDATE gate_reviews SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM gate_reviews
      WHERE status = 'pending' AND attempts < ${MAX_ATTEMPTS} ${brandFilter}
      ORDER BY created_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING id`);
  const ids = (claimed as unknown as { id: string }[]).map((r) => r.id);
  if (!ids.length) return 0;

  const reviews = await db.select().from(schema.gateReviews).where(inArray(schema.gateReviews.id, ids));
  for (const review of reviews) {
    const t0 = new Date();
    try {
      const { criteria, overallPass, groundingSource, b3Version } = await runGateReview(review);
      const done = await db
        .update(schema.gateReviews)
        .set({ status: "complete", overallPass, criteriaJson: criteria, reviewer: "ai", groundingSource, b3Version, completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.gateReviews.id, review.id), eq(schema.gateReviews.status, "running")))
        .returning({ id: schema.gateReviews.id });
      if (!done.length) continue;
      const [{ c }] = await db
        .select({ c: sql<number>`coalesce(sum(${schema.usageEvents.costUsd}),0)`.mapWith(Number) })
        .from(schema.usageEvents)
        .where(and(eq(schema.usageEvents.systemKey, SYSTEM_KEY), eq(schema.usageEvents.brandId, review.brandId), gte(schema.usageEvents.createdAt, t0)));
      await setReview(review.id, { costCents: Math.round((c ?? 0) * 100) });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      if (isTransient(e)) await setReview(review.id, { status: "pending", attempts: Math.max(0, review.attempts - 1), errorMessage: msg });
      else { const exhausted = review.attempts >= MAX_ATTEMPTS; await setReview(review.id, { status: exhausted ? "failed" : "pending", errorMessage: msg }); }
    }
  }
  return reviews.length;
}

export async function runGateTick(brandId: string): Promise<number> { return claimAndRun(brandId, 2); }
export async function runGateCron(): Promise<number> { const a = await claimAndRun(undefined, 6); await sweepStuck(); return a; }
export async function sweepStuck(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  await db.update(schema.gateReviews).set({ status: "failed", errorMessage: "Timed out (sweep)", updatedAt: new Date() }).where(and(inArray(schema.gateReviews.status, ["pending", "running"]), lt(schema.gateReviews.updatedAt, cutoff)));
}
