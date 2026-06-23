import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { startScrapeJob } from "@/systems/competitor-research/scrape-job";
import { type ScrapeMode } from "@/systems/competitor-research/meta-url";

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

  const mode: ScrapeMode = (["url", "page_id", "keyword"] as const).includes(body.mode as ScrapeMode) ? (body.mode as ScrapeMode) : "url";

  try {
    const { jobId } = await startScrapeJob({
      brandId: body.brandId,
      mode,
      query: body.query,
      country: body.country,
      requestedCount: body.requestedCount,
      competitorId: body.competitorId ?? null,
    });
    return NextResponse.json({ jobId, status: "pending" }, { status: 202 });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    const status = /Ad Library URL/.test(msg) ? 400 : 502;
    return NextResponse.json({ error: status === 400 ? msg : `Apify start failed: ${msg.slice(0, 200)}` }, { status });
  }
}
