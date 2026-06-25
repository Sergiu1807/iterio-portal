import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SYSTEM_KEY } from "./constants";
import { generateBrief } from "./generate";

const MAX_ATTEMPTS = 3;

type BriefRow = typeof schema.briefs.$inferSelect;

function isTransient(e: unknown): boolean {
  if (e instanceof Anthropic.APIError) { const s = e.status ?? 0; return s === 429 || s >= 500; }
  return /connection error|fetch failed|econnreset|etimedout|socket|network|timed out|overloaded/i.test(String((e as { message?: string })?.message ?? e));
}

const setBrief = (id: string, patch: Partial<BriefRow>) =>
  db.update(schema.briefs).set({ ...patch, updatedAt: new Date() }).where(eq(schema.briefs.id, id));

/** Atomic-claim + run pending briefs (briefs row IS the queue item). */
async function claimAndRun(brandId?: string, limit = 3): Promise<number> {
  const brandFilter = brandId ? sql`AND brand_id = ${brandId}` : sql``;
  const claimed = await db.execute(sql`
    UPDATE briefs SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM briefs
      WHERE status = 'pending' AND attempts < ${MAX_ATTEMPTS} ${brandFilter}
      ORDER BY created_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING id`);
  const ids = (claimed as unknown as { id: string }[]).map((r) => r.id);
  if (!ids.length) return 0;

  const briefs = await db.select().from(schema.briefs).where(inArray(schema.briefs.id, ids));
  for (const brief of briefs) {
    const t0 = new Date();
    try {
      const { briefJson, compliance, groundingSource, b3Version } = await generateBrief(brief);

      // Guarded finalize — only the writer that still sees 'running' completes.
      const done = await db
        .update(schema.briefs)
        .set({ status: "complete", briefJson, complianceNotesJson: compliance, groundingSource, b3Version, completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.briefs.id, brief.id), eq(schema.briefs.status, "running")))
        .returning({ id: schema.briefs.id });
      if (!done.length) continue;

      // CLOSE THE HANDOFF: backfill the angle's brief_id + mark it sent_to_brief.
      if (brief.angleId) {
        await db.update(schema.angles).set({ briefId: brief.id, status: "sent_to_brief" }).where(eq(schema.angles.id, brief.angleId));
      }

      const [{ c }] = await db
        .select({ c: sql<number>`coalesce(sum(${schema.usageEvents.costUsd}),0)`.mapWith(Number) })
        .from(schema.usageEvents)
        .where(and(eq(schema.usageEvents.systemKey, SYSTEM_KEY), eq(schema.usageEvents.brandId, brief.brandId), gte(schema.usageEvents.createdAt, t0)));
      await setBrief(brief.id, { costCents: Math.round((c ?? 0) * 100) });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      if (isTransient(e)) {
        await setBrief(brief.id, { status: "pending", attempts: Math.max(0, brief.attempts - 1), errorMessage: msg });
      } else {
        const exhausted = brief.attempts >= MAX_ATTEMPTS;
        await setBrief(brief.id, { status: exhausted ? "failed" : "pending", errorMessage: msg });
      }
    }
  }
  return briefs.length;
}

export async function runBriefTick(brandId: string): Promise<number> {
  return claimAndRun(brandId, 2);
}

export async function runBriefCron(): Promise<number> {
  const advanced = await claimAndRun(undefined, 6);
  await sweepStuck();
  return advanced;
}

export async function sweepStuck(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  await db
    .update(schema.briefs)
    .set({ status: "failed", errorMessage: "Timed out (sweep)", updatedAt: new Date() })
    .where(and(inArray(schema.briefs.status, ["pending", "running"]), lt(schema.briefs.updatedAt, cutoff)));
}
