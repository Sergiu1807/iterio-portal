import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** List a brand's gate reviews (newest first), with a signed thumbnail for each asset. */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const url = new URL(req.url);
  const brandId = url.searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  const status = url.searchParams.get("status"); // pass | fail | running

  let rows = await db.select().from(schema.gateReviews).where(eq(schema.gateReviews.brandId, brandId)).orderBy(desc(schema.gateReviews.createdAt)).limit(200);
  if (status === "pass") rows = rows.filter((r) => r.overallPass === true);
  else if (status === "fail") rows = rows.filter((r) => r.status === "complete" && r.overallPass === false);
  else if (status) rows = rows.filter((r) => r.status === status);

  const reviews = await Promise.all(rows.map(async (r) => ({ ...r, assetUrl: r.assetPath && !/^https?:\/\//.test(r.assetPath) ? await signedUrl(r.assetPath) : r.assetPath })));
  return NextResponse.json({ reviews });
}
