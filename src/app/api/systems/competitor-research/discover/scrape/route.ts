import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { scrapeSelectedCompetitors, type SelectedCompetitor } from "@/systems/competitor-research/discover";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // N parallel Apify starts

/** Phase 2: persist the chosen competitors + fan out their Ad Library scrapes. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { brandId, niche, selected } = (await req.json()) as { brandId?: string; niche?: string; selected?: SelectedCompetitor[] };
  if (!brandId || !Array.isArray(selected) || selected.length === 0) {
    return NextResponse.json({ error: "brandId and at least one selected competitor are required" }, { status: 400 });
  }
  const [brand] = await db.select({ id: schema.brands.id }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  try {
    const result = await scrapeSelectedCompetitors(brandId, niche ?? "", selected);
    if (result.jobsStarted === 0) {
      return NextResponse.json({ error: "Couldn't start any scrapes — try again.", ...result }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: `Scrape start failed: ${String((e as Error)?.message ?? e).slice(0, 200)}` }, { status: 502 });
  }
}
