import { NextResponse } from "next/server";
import { assertCron } from "@/lib/cron";
import { sweepStuck } from "@/systems/brand-foundation/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = assertCron(req);
  if (denied) return denied;
  await sweepStuck();
  return NextResponse.json({ ok: true });
}
