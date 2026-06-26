import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Completed static creatives a brand can send through the gate (with signed thumbnails). */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const statics = await db
    .select({ id: schema.staticAdGenerations.id, imagePath: schema.staticAdGenerations.imagePath, adCopy: schema.staticAdGenerations.adCopy, aspectRatio: schema.staticAdGenerations.aspectRatio })
    .from(schema.staticAdGenerations)
    .where(and(eq(schema.staticAdGenerations.brandId, brandId), eq(schema.staticAdGenerations.status, "completed")))
    .orderBy(desc(schema.staticAdGenerations.createdAt))
    .limit(40);

  const reviewable = await Promise.all(
    statics.filter((s) => s.imagePath).map(async (s) => ({ sourceSystem: "static" as const, id: s.id, imagePath: s.imagePath, thumbUrl: await signedUrl(s.imagePath), label: (s.adCopy || "Static ad").slice(0, 60), aspectRatio: s.aspectRatio }))
  );
  return NextResponse.json({ reviewable });
}
