import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { assertCron } from "@/lib/cron";
import { advanceAllVideoGenerations } from "@/systems/video-generation/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Backstop: advance in-flight videos + fail rows whose pipeline never submitted. */
export async function GET(req: Request) {
  const denied = assertCron(req);
  if (denied) return denied;

  const advanced = await advanceAllVideoGenerations(15);

  // Rows stuck 'pending' (pipeline never reached submit) > 15 min → error.
  await db
    .update(schema.videoGenerations)
    .set({ status: "error", errorMessage: "Pipeline timed out (sweep)", updatedAt: new Date() })
    .where(and(eq(schema.videoGenerations.status, "pending"), lt(schema.videoGenerations.updatedAt, new Date(Date.now() - 15 * 60_000))));

  return NextResponse.json({ advanced });
}
