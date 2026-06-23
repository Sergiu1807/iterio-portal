import { NextResponse } from "next/server";
import { assertCron } from "@/lib/cron";
import { scoreAnalyzedJobs } from "@/systems/competitor-research/scoring-run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Advance jobs in the 'scoring' stage → cluster + composite Winner Score + Angle Bank → complete. */
export async function GET(req: Request) {
  const denied = assertCron(req);
  if (denied) return denied;
  const scored = await scoreAnalyzedJobs();
  return NextResponse.json({ scored });
}
