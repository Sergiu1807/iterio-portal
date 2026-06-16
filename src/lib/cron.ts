import "server-only";
import { NextResponse } from "next/server";

/** Gate cron routes with CRON_SECRET in prod; open in dev. */
export function assertCron(req: Request): NextResponse | null {
  if (process.env.NODE_ENV === "development") return null;
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
