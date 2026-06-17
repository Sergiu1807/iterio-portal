import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** All video generations for a brand (newest first), with signed URLs. */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const rows = await db
    .select()
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.brandId, brandId))
    .orderBy(desc(schema.videoGenerations.createdAt))
    .limit(200);

  const generations = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      videoType: r.videoType,
      arollStyle: r.arollStyle,
      mode: r.mode,
      status: r.status,
      duration: r.duration,
      aspectRatio: r.aspectRatio,
      resolution: r.resolution,
      videoUrl: await signedUrl(r.videoPath),
      thumbUrl: await signedUrl(r.thumbnailPath),
      errorMessage: r.errorMessage,
      finalPrompt: r.finalPrompt,
      script: r.script,
      productId: r.productId,
      batchId: r.batchId,
      batchIndex: r.batchIndex,
      batchSize: r.batchSize,
      createdAt: r.createdAt,
    }))
  );

  return NextResponse.json({ generations });
}
