import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { assertCron } from "@/lib/cron";
import { advanceAllGenerations } from "@/systems/static-generation/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Backstop for the Static Ad pipeline: advance in-flight generations and fail
 *  prompt-builds that got stuck (placeholders remain usable). */
export async function GET(req: Request) {
  const denied = assertCron(req);
  if (denied) return denied;

  const advanced = await advanceAllGenerations(20);

  // Config builds stuck > 15 min → error (placeholders stay live).
  await db
    .update(schema.staticAdConfig)
    .set({ status: "error", buildError: "Build timed out (sweep)", updatedAt: new Date() })
    .where(and(eq(schema.staticAdConfig.status, "building"), lt(schema.staticAdConfig.updatedAt, new Date(Date.now() - 15 * 60_000))));

  return NextResponse.json({ advanced });
}
