import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getApiKey } from "@/lib/api-keys";
import { discoverCandidates } from "@/systems/competitor-research/discover";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Tavily search + Claude extraction

/** Phase 1: one brand in → return candidate competitors for review (no scraping). */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { brandId, input } = (await req.json()) as { brandId?: string; input?: string };
  if (!brandId || !input?.trim()) {
    return NextResponse.json({ error: "brandId and input are required" }, { status: 400 });
  }
  const [brand] = await db.select({ id: schema.brands.id }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  if (!(await getApiKey("TAVILY_API_KEY"))) {
    return NextResponse.json({ error: "Add a Tavily API key in Admin → API Keys to auto-discover competitors." }, { status: 400 });
  }

  try {
    const result = await discoverCandidates(input.trim(), brandId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: `Discovery failed: ${String((e as Error)?.message ?? e).slice(0, 200)}` }, { status: 502 });
  }
}
