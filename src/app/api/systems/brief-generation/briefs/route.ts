import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** List a brand's briefs (optionally filtered by status/format). */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const url = new URL(req.url);
  const brandId = url.searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  const status = url.searchParams.get("status");
  const format = url.searchParams.get("format");

  const conds = [eq(schema.briefs.brandId, brandId)];
  if (status) conds.push(eq(schema.briefs.status, status));
  if (format) conds.push(eq(schema.briefs.format, format));

  const briefs = await db.select().from(schema.briefs).where(and(...conds)).orderBy(desc(schema.briefs.createdAt)).limit(200);
  return NextResponse.json({ briefs });
}
