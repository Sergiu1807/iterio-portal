import { NextResponse } from "next/server";
import { assertCron } from "@/lib/cron";
import { runCopyCron } from "@/systems/ad-copy/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function GET(req: Request) {
  const denied = assertCron(req);
  if (denied) return denied;
  const advanced = await runCopyCron();
  return NextResponse.json({ advanced });
}
