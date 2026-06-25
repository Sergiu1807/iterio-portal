import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { ANGLE_STATUSES } from "@/systems/ideation/constants";

export const dynamic = "force-dynamic";

const EDITABLE = ["title", "format", "funnelStage", "bigIdea", "hook", "emotionalDriver", "targetPersona", "proofMechanism", "sourceInspiration", "differentiationNote"] as const;

/** Update an angle: status (shortlist/approve/send-to-brief) and/or edit fields. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  if (typeof body.status === "string" && (ANGLE_STATUSES as readonly string[]).includes(body.status)) patch.status = body.status;
  for (const k of EDITABLE) if (k in body) patch[k] = body[k] === "" ? null : body[k];
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const [row] = await db.update(schema.angles).set(patch).where(eq(schema.angles.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Angle not found" }, { status: 404 });
  return NextResponse.json({ angle: row });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = await params;
  await db.delete(schema.angles).where(eq(schema.angles.id, id));
  return NextResponse.json({ ok: true });
}
