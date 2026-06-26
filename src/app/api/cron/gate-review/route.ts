import { NextResponse } from "next/server";
import { assertCron } from "@/lib/cron";
import { runGateCron } from "@/systems/gate-review/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const denied = assertCron(req);
  if (denied) return denied;
  const advanced = await runGateCron();
  return NextResponse.json({ advanced });
}
