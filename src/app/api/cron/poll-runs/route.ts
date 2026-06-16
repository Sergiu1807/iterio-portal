import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { assertCron } from "@/lib/cron";
import { pollAndIngestJob } from "@/systems/competitor-research/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = assertCron(req);
  if (denied) return denied;

  const jobs = await db
    .select()
    .from(schema.scrapeJobs)
    .where(inArray(schema.scrapeJobs.status, ["pending", "running", "ingesting"]))
    .limit(10);

  for (const job of jobs) {
    try {
      await pollAndIngestJob(job);
    } catch (e) {
      console.warn("[cron/poll-runs] job failed", job.id, e);
    }
  }
  return NextResponse.json({ processed: jobs.length });
}
