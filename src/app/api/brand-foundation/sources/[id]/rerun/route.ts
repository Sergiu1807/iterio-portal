import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { rerunSource } from "@/systems/brand-foundation/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = await params;
  const [s] = await db.select({ brandId: schema.brandSources.brandId }).from(schema.brandSources).where(eq(schema.brandSources.id, id)).limit(1);
  if (!s) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  after(() => rerunSource(s.brandId, id).catch((e) => console.warn("[brand-foundation] rerun failed", e)));
  return NextResponse.json({ started: true }, { status: 202 });
}
