import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  const sources = await db.select().from(schema.competitors).where(eq(schema.competitors.brandId, brandId));
  return NextResponse.json({ sources });
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const b = (await req.json()) as {
    brandId?: string;
    name?: string;
    metaPageId?: string;
    metaSearchTerms?: string;
    websiteUrl?: string;
    type?: string;
  };
  if (!b.brandId || !b.name?.trim()) return NextResponse.json({ error: "brandId and name required" }, { status: 400 });
  const [source] = await db
    .insert(schema.competitors)
    .values({
      brandId: b.brandId,
      name: b.name.trim(),
      metaPageId: b.metaPageId?.trim() || null,
      metaSearchTerms: b.metaSearchTerms?.trim() || null,
      websiteUrl: b.websiteUrl?.trim() || null,
      type: b.type?.trim() || "Direct",
    })
    .returning();
  return NextResponse.json({ source }, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id, ...patch } = (await req.json()) as { id?: string } & Record<string, unknown>;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const allowed: Record<string, unknown> = {};
  for (const k of ["name", "metaPageId", "metaSearchTerms", "websiteUrl", "type", "isActive"]) {
    if (k in patch) allowed[k] = patch[k];
  }
  allowed.updatedAt = new Date();
  await db.update(schema.competitors).set(allowed).where(eq(schema.competitors.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = (await req.json()) as { id?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.delete(schema.competitors).where(eq(schema.competitors.id, id));
  return NextResponse.json({ ok: true });
}
