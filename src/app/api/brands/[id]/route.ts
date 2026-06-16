import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { updateBrandRecord, deleteBrandRecord } from "@/lib/brands";
import type { Brand } from "@/lib/types";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }
  const { id } = await params;
  const patch = (await req.json()) as Partial<Brand>;
  const brand = await updateBrandRecord(id, patch);
  if (!brand) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ brand });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const { id } = await params;
  await deleteBrandRecord(id);
  return NextResponse.json({ ok: true });
}
