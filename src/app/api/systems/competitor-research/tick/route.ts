import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { pollAndIngestJob } from "@/systems/competitor-research/ingest";
import { analyzeQueued } from "@/systems/competitor-research/analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Authed, UI-driven pipeline step: advances this brand's active jobs while the
 *  user watches. Vercel crons are the backstop when the UI isn't open. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { brandId } = (await req.json()) as { brandId?: string };
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const jobs = await db
    .select()
    .from(schema.scrapeJobs)
    .where(and(eq(schema.scrapeJobs.brandId, brandId), inArray(schema.scrapeJobs.status, ["pending", "running", "ingesting"])))
    .limit(5);

  for (const job of jobs) {
    try {
      await pollAndIngestJob(job);
    } catch (e) {
      console.warn("[tick] job failed", job.id, e);
    }
  }

  const analyzed = await analyzeQueued(4);
  return NextResponse.json({ activeJobs: jobs.length, analyzed });
}
