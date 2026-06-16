import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

/** Re-sign an ad's media (signed URLs expire after ~1h; the UI calls this on
 *  media onError so a long-open modal/grid self-heals instead of breaking). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { id } = await params;

  const [ad] = await db
    .select({
      primaryThumbnail: schema.competitorAds.primaryThumbnail,
      videoPath: schema.competitorAds.videoPath,
      mediaCards: schema.competitorAds.mediaCards,
    })
    .from(schema.competitorAds)
    .where(eq(schema.competitorAds.id, id))
    .limit(1);
  if (!ad) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    thumbUrl: await signedUrl(ad.primaryThumbnail),
    videoUrl: await signedUrl(ad.videoPath),
    cardUrls: (await Promise.all((ad.mediaCards ?? []).map((p) => signedUrl(p)))).filter(Boolean) as string[],
  });
}
