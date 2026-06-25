import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { startIdeation } from "@/systems/ideation/generate";

export const dynamic = "force-dynamic";

/** "Regenerate similar" — new batch seeded from an existing angle, inheriting its batch params. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const { angleId } = (await req.json().catch(() => ({}))) as { angleId?: string };
  if (!angleId) return NextResponse.json({ error: "angleId required" }, { status: 400 });

  const [angle] = await db.select().from(schema.angles).where(eq(schema.angles.id, angleId)).limit(1);
  if (!angle) return NextResponse.json({ error: "Angle not found" }, { status: 404 });
  const [batch] = await db.select().from(schema.angleBatches).where(eq(schema.angleBatches.id, angle.batchId)).limit(1);

  try {
    const out = await startIdeation({
      brandId: angle.brandId,
      productId: batch?.productId ?? null,
      objective: batch?.objective ?? undefined,
      funnelStage: batch?.funnelStage,
      formats: batch?.formats,
      count: batch?.count,
      theme: batch?.theme ?? undefined,
      seedAngleId: angleId,
    });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
  }
}
