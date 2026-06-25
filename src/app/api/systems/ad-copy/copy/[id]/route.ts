import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";
const EDITABLE = ["primaryText", "headline", "cta"] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (body.status === "approved" || body.status === "draft") patch.status = body.status;
  for (const k of EDITABLE) if (k in body) patch[k] = body[k] === "" ? null : body[k];
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  const [row] = await db.update(schema.adCopy).set(patch).where(eq(schema.adCopy.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Copy not found" }, { status: 404 });
  return NextResponse.json({ copy: row });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = await params;
  await db.delete(schema.adCopy).where(eq(schema.adCopy.id, id));
  return NextResponse.json({ ok: true });
}
