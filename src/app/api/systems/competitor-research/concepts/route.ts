import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

const WEEK = 7 * 86_400_000;

/** Scored CONCEPT clusters for a brand (the Winner Board), newest-winning first. */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const concepts = await db
    .select()
    .from(schema.conceptClusters)
    .where(eq(schema.conceptClusters.brandId, brandId))
    .orderBy(desc(schema.conceptClusters.winnerScore))
    .limit(200);

  if (!concepts.length) return NextResponse.json({ concepts: [], momentum: [] });

  const conceptIds = concepts.map((c) => c.id);

  const banks = await db
    .select()
    .from(schema.angleBankEntries)
    .where(inArray(schema.angleBankEntries.conceptId, conceptIds));
  const bankByConcept = new Map(banks.map((b) => [b.conceptId, b]));

  const repIds = concepts.map((c) => c.representativeAdId).filter((id): id is string => !!id);
  const reps = repIds.length
    ? await db
        .select({
          id: schema.competitorAds.id,
          primaryThumbnail: schema.competitorAds.primaryThumbnail,
          videoPath: schema.competitorAds.videoPath,
          mediaType: schema.competitorAds.mediaType,
        })
        .from(schema.competitorAds)
        .where(inArray(schema.competitorAds.id, repIds))
    : [];
  const repById = new Map(reps.map((r) => [r.id, r]));

  // variant ad ids per concept (for the "View variants" drill-down)
  const members = await db
    .select({ id: schema.competitorAds.id, conceptId: schema.competitorAds.conceptId })
    .from(schema.competitorAds)
    .where(inArray(schema.competitorAds.conceptId, conceptIds));
  const variantsByConcept = new Map<string, string[]>();
  for (const m of members) {
    if (!m.conceptId) continue;
    const arr = variantsByConcept.get(m.conceptId) ?? [];
    arr.push(m.id);
    variantsByConcept.set(m.conceptId, arr);
  }

  const now = Date.now();

  const out = await Promise.all(
    concepts.map(async (c) => {
      const bank = bankByConcept.get(c.id);
      const rep = c.representativeAdId ? repById.get(c.representativeAdId) : undefined;
      const history = c.countHistory ?? [];
      const last = history[history.length - 1];
      const prev = history.length >= 2 ? history[history.length - 2] : null;
      const wowDelta = last && prev ? last.activeVariantCount - prev.activeVariantCount : 0;
      const isNewThisWeek = now - new Date(c.createdAt).getTime() < WEEK;
      return {
        id: c.id,
        title: bank?.angle || c.advertiser || "Untitled concept",
        advertiser: c.advertiser,
        tier: c.winnerTier,
        winnerScore: c.winnerScore,
        confidence: c.confidence,
        activeDays: c.activeDays,
        activeVariantCount: c.activeVariantCount,
        totalVariantCount: c.totalVariantCount,
        stillActive: c.stillActive,
        formats: c.formats ?? [],
        euReach: c.euTotalReach ?? null,
        mediaType: rep?.mediaType ?? null,
        thumbUrl: await signedUrl(rep?.primaryThumbnail),
        momentum: {
          wowDelta,
          isNewThisWeek,
          countHistory: history.map((h) => ({ at: h.at, count: h.activeVariantCount })),
        },
        angleBank: bank
          ? {
              angle: bank.angle,
              hook: bank.hook,
              mechanism: bank.mechanism,
              offer: bank.offer,
              awarenessLevel: bank.awarenessLevel,
              emotionalDriver: bank.emotionalDriver,
              secondaryDrivers: bank.secondaryDrivers ?? [],
              beatStructure: bank.beatStructure ?? [],
              visualNotes: bank.visualNotes,
              nativeScore: bank.nativeScore != null ? Number(bank.nativeScore) : null,
              complianceFlags: bank.complianceFlags ?? [],
              status: bank.status,
            }
          : null,
        variantAdIds: variantsByConcept.get(c.id) ?? [],
      };
    })
  );

  const momentum = out
    .filter((c) => c.momentum.isNewThisWeek || c.momentum.wowDelta > 0)
    .sort((a, b) => b.winnerScore - a.winnerScore)
    .slice(0, 12);

  return NextResponse.json({ concepts: out, momentum });
}
