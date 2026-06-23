import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Saved/curated winners for a brand (the swipe library). */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  const items = await db
    .select()
    .from(schema.swipeLibrary)
    .where(eq(schema.swipeLibrary.brandId, brandId))
    .orderBy(desc(schema.swipeLibrary.createdAt))
    .limit(200);
  return NextResponse.json({ items });
}

/** Save a concept (+ its Angle Bank teardown) into the swipe library. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const b = (await req.json()) as { brandId?: string; conceptId?: string; tags?: string[]; note?: string };
  if (!b.brandId || !b.conceptId) return NextResponse.json({ error: "brandId and conceptId required" }, { status: 400 });

  const [concept] = await db
    .select()
    .from(schema.conceptClusters)
    .where(and(eq(schema.conceptClusters.id, b.conceptId), eq(schema.conceptClusters.brandId, b.brandId)))
    .limit(1);
  if (!concept) return NextResponse.json({ error: "concept not found" }, { status: 404 });

  const [bank] = await db
    .select()
    .from(schema.angleBankEntries)
    .where(eq(schema.angleBankEntries.conceptId, concept.id))
    .limit(1);

  // niche compounds the library — inherit from the owning competitor when known
  let niche: string | null = null;
  if (concept.competitorId) {
    const [comp] = await db.select({ niche: schema.competitors.niche }).from(schema.competitors).where(eq(schema.competitors.id, concept.competitorId)).limit(1);
    niche = comp?.niche ?? null;
  }

  // de-dupe: one swipe per concept per brand
  const [existing] = await db
    .select({ id: schema.swipeLibrary.id })
    .from(schema.swipeLibrary)
    .where(and(eq(schema.swipeLibrary.brandId, b.brandId), eq(schema.swipeLibrary.conceptId, concept.id)))
    .limit(1);
  if (existing) return NextResponse.json({ id: existing.id, alreadySaved: true });

  const [row] = await db
    .insert(schema.swipeLibrary)
    .values({
      brandId: b.brandId,
      conceptId: concept.id,
      angleBankEntryId: bank?.id ?? null,
      niche,
      tags: Array.isArray(b.tags) ? b.tags : [],
      note: b.note?.trim() || null,
      snapshot: {
        advertiser: concept.advertiser,
        winnerScore: concept.winnerScore,
        winnerTier: concept.winnerTier,
        confidence: concept.confidence,
        activeVariantCount: concept.activeVariantCount,
        activeDays: concept.activeDays,
        angle: bank?.angle ?? null,
        hook: bank?.hook ?? null,
        mechanism: bank?.mechanism ?? null,
        emotionalDriver: bank?.emotionalDriver ?? null,
        awarenessLevel: bank?.awarenessLevel ?? null,
      },
      savedBy: auth.profile.id,
    })
    .returning({ id: schema.swipeLibrary.id });

  return NextResponse.json({ id: row.id }, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = (await req.json()) as { id?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.delete(schema.swipeLibrary).where(eq(schema.swipeLibrary.id, id));
  return NextResponse.json({ ok: true });
}
