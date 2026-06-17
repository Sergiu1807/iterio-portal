import { NextResponse } from "next/server";
import { and, eq, inArray, lt } from "drizzle-orm";
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

  // Rows stuck pre-Kie ('pending' = pipeline never ran; 'submitting' = claimed
  // but the submit never completed) > 15 min → error. No Kie job exists for
  // these, so failing them is safe (no orphaned credit).
  await db
    .update(schema.videoGenerations)
    .set({ status: "error", errorMessage: "Pipeline timed out (sweep)", updatedAt: new Date() })
    .where(and(inArray(schema.videoGenerations.status, ["pending", "submitting"]), lt(schema.videoGenerations.updatedAt, new Date(Date.now() - 15 * 60_000))));

  return NextResponse.json({ advanced });
}
