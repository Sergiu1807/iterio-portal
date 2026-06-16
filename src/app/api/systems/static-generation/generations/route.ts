import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** All generations for a brand (newest first), with signed image URLs. */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const rows = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.brandId, brandId))
    .orderBy(desc(schema.staticAdGenerations.createdAt))
    .limit(200);

  const generations = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      mode: r.mode,
      status: r.status,
      aspectRatio: r.aspectRatio,
      resolution: r.resolution,
      imageUrl: await signedUrl(r.imagePath),
      errorMessage: r.errorMessage,
      finalPrompt: r.finalPrompt,
      adCopy: r.adCopy,
      productId: r.productId,
      batchId: r.batchId,
      batchIndex: r.batchIndex,
      batchSize: r.batchSize,
      sourceGenerationId: r.sourceGenerationId,
      createdAt: r.createdAt,
    }))
  );

  return NextResponse.json({ generations });
}
