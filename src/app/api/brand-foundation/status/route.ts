import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Sources + their jobs for the live research grid. */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  const [sources, jobs] = await Promise.all([
    db.select().from(schema.brandSources).where(eq(schema.brandSources.brandId, brandId)),
    db.select().from(schema.researchJobs).where(eq(schema.researchJobs.brandId, brandId)).orderBy(desc(schema.researchJobs.createdAt)),
  ]);
  return NextResponse.json({ sources, jobs });
}
