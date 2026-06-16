import { NextResponse } from "next/server";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { assertCron } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = assertCron(req);
  if (denied) return denied;

  const now = Date.now();
  // jobs stuck in a non-terminal state for > 30 min → error
  await db
    .update(schema.scrapeJobs)
    .set({ status: "error", errorMessage: "Timed out (sweep)", updatedAt: new Date() })
    .where(
      and(
        inArray(schema.scrapeJobs.status, ["pending", "running", "ingesting", "analyzing"]),
        lt(schema.scrapeJobs.updatedAt, new Date(now - 30 * 60_000))
      )
    );

  // ads stuck 'processing' for > 15 min → requeue
  await db
    .update(schema.competitorAds)
    .set({ aiAnalysisStatus: "queued", updatedAt: new Date() })
    .where(
      and(
        eq(schema.competitorAds.aiAnalysisStatus, "processing"),
        lt(schema.competitorAds.updatedAt, new Date(now - 15 * 60_000))
      )
    );

  return NextResponse.json({ ok: true });
}
