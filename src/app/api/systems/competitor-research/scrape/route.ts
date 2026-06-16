import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { startApifyRun } from "@/lib/providers/apify";
import { resolveScrapeUrl, isAdLibraryUrl, META_ADS_ACTOR_ID, type ScrapeMode } from "@/systems/competitor-research/meta-url";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = (await req.json()) as {
    brandId?: string;
    competitorId?: string;
    mode?: ScrapeMode;
    query?: string;
    country?: string;
    requestedCount?: number;
  };

  if (!body.brandId || !body.query?.trim()) {
    return NextResponse.json({ error: "brandId and query are required" }, { status: 400 });
  }
  const [brand] = await db.select({ id: schema.brands.id }).from(schema.brands).where(eq(schema.brands.id, body.brandId)).limit(1);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const mode: ScrapeMode = (["url", "page_id", "keyword"] as const).includes(body.mode as ScrapeMode)
    ? (body.mode as ScrapeMode)
    : "url";
  const country = (body.country || "ALL").trim();
  const requestedCount = Math.min(50, Math.max(1, body.requestedCount || 20));
  const query = body.query.trim();

  if (mode === "url" && !isAdLibraryUrl(query)) {
    return NextResponse.json({ error: "Paste a valid Meta Ad Library URL (facebook.com/ads/library/…)" }, { status: 400 });
  }
  const url = resolveScrapeUrl({ mode, query, country });

  let runId: string;
  let datasetId: string | undefined;
  try {
    const run = await startApifyRun(META_ADS_ACTOR_ID, {
      count: requestedCount,
      scrapeAdDetails: true,
      urls: [{ url }],
      "scrapePageAds.activeStatus": "active",
      "scrapePageAds.countryCode": country,
    });
    runId = run.runId;
    datasetId = run.datasetId;
  } catch (e) {
    return NextResponse.json({ error: `Apify start failed: ${String(e).slice(0, 200)}` }, { status: 502 });
  }

  const [job] = await db
    .insert(schema.scrapeJobs)
    .values({
      brandId: body.brandId,
      competitorId: body.competitorId ?? null,
      platform: "meta",
      mode,
      query: body.query.trim(),
      country,
      requestedCount,
      status: "pending",
      apifyRunId: runId,
      apifyDatasetId: datasetId ?? null,
    })
    .returning({ id: schema.scrapeJobs.id });

  if (body.competitorId) {
    await db.update(schema.competitors).set({ lastScrapedAt: new Date() }).where(eq(schema.competitors.id, body.competitorId));
  }

  return NextResponse.json({ jobId: job.id, status: "pending" }, { status: 202 });
}
