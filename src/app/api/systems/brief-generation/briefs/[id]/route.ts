import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Update a brief: approve, edit briefJson/notes, mark sent-to-production, or regenerate. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; status?: string; notes?: string; briefJson?: Record<string, unknown>; sentToProduction?: string };

  // Regenerate = reset to pending so the pipeline re-runs this brief.
  if (body.action === "regenerate") {
    const [row] = await db.update(schema.briefs).set({ status: "pending", attempts: 0, errorMessage: null, updatedAt: new Date() }).where(eq(schema.briefs.id, id)).returning();
    if (!row) return NextResponse.json({ error: "Brief not found" }, { status: 404 });
    return NextResponse.json({ brief: row });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.status === "approved" || body.status === "complete") patch.status = body.status;
  if (typeof body.notes === "string") patch.notes = body.notes || null;
  if (body.briefJson && typeof body.briefJson === "object") patch.briefJson = body.briefJson;
  if (typeof body.sentToProduction === "string") patch.sentToProduction = body.sentToProduction;

  const [row] = await db.update(schema.briefs).set(patch).where(eq(schema.briefs.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  return NextResponse.json({ brief: row });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = await params;
  // detach the angle linkage so the angle can be re-briefed
  const [b] = await db.select({ angleId: schema.briefs.angleId }).from(schema.briefs).where(eq(schema.briefs.id, id)).limit(1);
  if (b?.angleId) await db.update(schema.angles).set({ briefId: null }).where(eq(schema.angles.id, b.angleId));
  await db.delete(schema.briefs).where(eq(schema.briefs.id, id));
  return NextResponse.json({ ok: true });
}
