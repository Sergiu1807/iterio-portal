import { NextResponse } from "next/server";
import { assertCron } from "@/lib/cron";
import { extractAll } from "@/systems/brand-foundation/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const denied = assertCron(req);
  if (denied) return denied;
  await extractAll();
  return NextResponse.json({ ok: true });
}
