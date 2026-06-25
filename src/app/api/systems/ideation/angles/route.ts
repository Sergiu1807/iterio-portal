import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** List a brand's angles (the library/results) + its recent batches (for progress). */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const url = new URL(req.url);
  const brandId = url.searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const status = url.searchParams.get("status"); // optional filter
  const format = url.searchParams.get("format");
  const compliance = url.searchParams.get("compliance");

  const conds = [eq(schema.angles.brandId, brandId)];
  if (status) conds.push(eq(schema.angles.status, status));
  if (format) conds.push(eq(schema.angles.format, format));
  if (compliance) conds.push(eq(schema.angles.complianceFlag, compliance));

  const [angles, batches] = await Promise.all([
    db.select().from(schema.angles).where(and(...conds)).orderBy(desc(schema.angles.createdAt)).limit(300),
    db.select().from(schema.angleBatches).where(eq(schema.angleBatches.brandId, brandId)).orderBy(desc(schema.angleBatches.createdAt)).limit(20),
  ]);

  return NextResponse.json({ angles, batches });
}
