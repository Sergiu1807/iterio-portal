import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Human override (flip overall pass/fail + optional per-criterion edits) or re-run. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; overallPass?: boolean; criteria?: { key: string; label: string; score: number; pass: boolean; note: string }[]; notes?: string };

  if (body.action === "regenerate") {
    const [row] = await db.update(schema.gateReviews).set({ status: "pending", attempts: 0, errorMessage: null, overridden: false, reviewer: "ai", updatedAt: new Date() }).where(eq(schema.gateReviews.id, id)).returning();
    if (!row) return NextResponse.json({ error: "Review not found" }, { status: 404 });
    return NextResponse.json({ review: row });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date(), reviewer: "human", overridden: true };
  if (typeof body.overallPass === "boolean") patch.overallPass = body.overallPass;
  if (Array.isArray(body.criteria)) patch.criteriaJson = body.criteria;
  if (typeof body.notes === "string") patch.notes = body.notes || null;
  const [row] = await db.update(schema.gateReviews).set(patch).where(eq(schema.gateReviews.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  return NextResponse.json({ review: row });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = await params;
  await db.delete(schema.gateReviews).where(eq(schema.gateReviews.id, id));
  return NextResponse.json({ ok: true });
}
