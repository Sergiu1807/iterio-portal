import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Attachable "recreate-this-winner" references for a brand: competitor winners + past statics. */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const [ads, statics] = await Promise.all([
    db.select({ id: schema.competitorAds.id, thumb: schema.competitorAds.primaryThumbnail, angle: schema.competitorAds.creativeAngle, headline: schema.competitorAds.headlineTitle, driver: schema.competitorAds.emotionalDriver })
      .from(schema.competitorAds).where(eq(schema.competitorAds.brandId, brandId)).orderBy(desc(schema.competitorAds.createdAt)).limit(18),
    db.select({ id: schema.staticAdGenerations.id, image: schema.staticAdGenerations.imagePath, adCopy: schema.staticAdGenerations.adCopy })
      .from(schema.staticAdGenerations).where(and(eq(schema.staticAdGenerations.brandId, brandId), eq(schema.staticAdGenerations.status, "completed"))).orderBy(desc(schema.staticAdGenerations.createdAt)).limit(12),
  ]);

  const references = [
    ...(await Promise.all(ads.filter((a) => a.angle || a.headline).map(async (a) => ({
      kind: "competitor_ad" as const,
      id: a.id,
      storageKey: a.thumb,
      label: (a.angle || a.headline || "Competitor ad").slice(0, 80),
      sub: a.driver ?? null,
      thumbUrl: await signedUrl(a.thumb),
    })))),
    ...(await Promise.all(statics.map(async (s) => ({
      kind: "static" as const,
      id: s.id,
      storageKey: s.image,
      label: (s.adCopy || "Past static").slice(0, 80),
      sub: "your static",
      thumbUrl: await signedUrl(s.image),
    })))),
  ];
  return NextResponse.json({ references });
}
