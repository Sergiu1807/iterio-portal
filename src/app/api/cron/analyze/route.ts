import { NextResponse } from "next/server";
import { assertCron } from "@/lib/cron";
import { analyzeQueued } from "@/systems/competitor-research/analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = assertCron(req);
  if (denied) return denied;
  const analyzed = await analyzeQueued(6);
  return NextResponse.json({ analyzed });
}
