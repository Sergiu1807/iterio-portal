import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const jobs = await db
    .select()
    .from(schema.scrapeJobs)
    .where(eq(schema.scrapeJobs.brandId, brandId))
    .orderBy(desc(schema.scrapeJobs.createdAt))
    .limit(10);

  const ads = await db
    .select()
    .from(schema.competitorAds)
    .where(eq(schema.competitorAds.brandId, brandId))
    .orderBy(desc(schema.competitorAds.createdAt))
    .limit(60);

  const adsWithUrls = await Promise.all(
    ads.map(async (a) => ({ ...a, thumbUrl: await signedUrl(a.primaryThumbnail) }))
  );

  return NextResponse.json({ jobs, ads: adsWithUrls });
}
