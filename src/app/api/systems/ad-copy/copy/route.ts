import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** List a brand's ad copy + recent batches (for progress). */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const url = new URL(req.url);
  const brandId = url.searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  const status = url.searchParams.get("status");
  const placement = url.searchParams.get("placement");
  const compliance = url.searchParams.get("compliance");

  const conds = [eq(schema.adCopy.brandId, brandId)];
  if (status) conds.push(eq(schema.adCopy.status, status));
  if (placement) conds.push(eq(schema.adCopy.placement, placement));
  if (compliance) conds.push(eq(schema.adCopy.complianceFlag, compliance));

  const [copy, batches] = await Promise.all([
    db.select().from(schema.adCopy).where(and(...conds)).orderBy(desc(schema.adCopy.createdAt)).limit(300),
    db.select().from(schema.adCopyBatches).where(eq(schema.adCopyBatches.brandId, brandId)).orderBy(desc(schema.adCopyBatches.createdAt)).limit(20),
  ]);
  return NextResponse.json({ copy, batches });
}
