import { NextResponse } from "next/server";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { assertCron } from "@/lib/cron";
import { MAX_ATTEMPTS } from "@/systems/competitor-research/analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = assertCron(req);
  if (denied) return denied;

  const now = Date.now();

  // 1. Jobs stuck in a non-terminal state for > 30 min → error.
  await db
    .update(schema.scrapeJobs)
    .set({ status: "error", errorMessage: "Timed out (sweep)", updatedAt: new Date() })
    .where(
      and(
        inArray(schema.scrapeJobs.status, ["pending", "running", "ingesting", "analyzing"]),
        lt(schema.scrapeJobs.updatedAt, new Date(now - 30 * 60_000))
      )
    );

  // 2. Ads stuck 'processing' > 15 min (a killed/timed-out analyze pass) → requeue
  //    and HAND BACK the attempt (a timeout isn't a content failure), so a genuine
  //    error path still bounds retries while transient deaths don't burn budget.
  await db
    .update(schema.competitorAds)
    .set({ aiAnalysisStatus: "queued", aiAttempts: sql`greatest(${schema.competitorAds.aiAttempts} - 1, 0)`, updatedAt: new Date() })
    .where(and(eq(schema.competitorAds.aiAnalysisStatus, "processing"), lt(schema.competitorAds.updatedAt, new Date(now - 15 * 60_000))));

  // 3. Reconcile any ad stranded 'queued' at/over the cap → 'failed' so its job can complete.
  await db
    .update(schema.competitorAds)
    .set({ aiAnalysisStatus: "failed", aiErrorMessage: sql`coalesce(${schema.competitorAds.aiErrorMessage}, 'Exhausted attempts (sweep)')`, updatedAt: new Date() })
    .where(and(eq(schema.competitorAds.aiAnalysisStatus, "queued"), gte(schema.competitorAds.aiAttempts, MAX_ATTEMPTS)));

  return NextResponse.json({ ok: true });
}
