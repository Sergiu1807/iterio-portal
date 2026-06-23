import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getApiKey } from "@/lib/api-keys";
import { runDiscovery } from "@/systems/competitor-research/discover";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Tavily search + Claude extraction + N Apify starts

/** One brand in → discover competitors → fan out scrapes. Returns the niche +
 *  competitor set; the existing pipeline harvests them (the UI then pumps). */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { brandId, input, count } = (await req.json()) as { brandId?: string; input?: string; count?: number };
  if (!brandId || !input?.trim()) {
    return NextResponse.json({ error: "brandId and input are required" }, { status: 400 });
  }
  const [brand] = await db.select({ id: schema.brands.id }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  if (!(await getApiKey("TAVILY_API_KEY"))) {
    return NextResponse.json({ error: "Add a Tavily API key in Admin → API Keys to auto-discover competitors." }, { status: 400 });
  }

  try {
    const result = await runDiscovery(brandId, input.trim(), Math.min(100, Math.max(1, count || 20)));
    if (result.jobsStarted === 0) {
      return NextResponse.json({ error: "Found no competitors to scrape — try a more specific brand name or add competitors manually.", ...result }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: `Discovery failed: ${String((e as Error)?.message ?? e).slice(0, 200)}` }, { status: 502 });
  }
}
