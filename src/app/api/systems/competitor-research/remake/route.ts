import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { prepareStaticRemake, prepareVideoRemake } from "@/systems/competitor-research/remake";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // deep analysis + compose + gate

/** Prepare an on-brand remake of a winning concept → returns a prefill payload for
 *  the EXISTING Static (Reference mode) or Video Create form. Generation happens
 *  when the user reviews and hits Generate there. The compliance gate is advisory. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = (await req.json()) as { brandId?: string; conceptId?: string; target?: "static" | "video" };
  const target = body.target === "video" ? "video" : "static";
  if (!body.brandId || !body.conceptId) {
    return NextResponse.json({ error: "brandId and conceptId are required" }, { status: 400 });
  }

  // For Static, the brand's Static system must be set up (the Create form needs its config).
  if (target === "static") {
    const [cfg] = await db.select({ id: schema.staticAdConfig.id }).from(schema.staticAdConfig).where(eq(schema.staticAdConfig.brandId, body.brandId)).limit(1);
    if (!cfg) return NextResponse.json({ error: "Set up the Static system for this brand first (Static → Set up)." }, { status: 400 });
  }

  const [concept] = await db
    .select()
    .from(schema.conceptClusters)
    .where(and(eq(schema.conceptClusters.id, body.conceptId), eq(schema.conceptClusters.brandId, body.brandId)))
    .limit(1);
  if (!concept) return NextResponse.json({ error: "Concept not found" }, { status: 404 });

  const [bank] = await db.select().from(schema.angleBankEntries).where(eq(schema.angleBankEntries.conceptId, concept.id)).limit(1);
  if (!bank) return NextResponse.json({ error: "This concept hasn't been analyzed into an Angle Bank entry yet." }, { status: 400 });

  const repId = concept.representativeAdId ?? bank.representativeAdId;
  if (!repId) return NextResponse.json({ error: "No representative ad for this concept." }, { status: 400 });
  const [ad] = await db.select().from(schema.competitorAds).where(eq(schema.competitorAds.id, repId)).limit(1);
  if (!ad) return NextResponse.json({ error: "Representative ad not found." }, { status: 400 });

  try {
    const prefill = target === "video" ? await prepareVideoRemake(body.brandId, concept.id, ad, bank) : await prepareStaticRemake(body.brandId, concept.id, ad, bank);
    return NextResponse.json(prefill);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    const status = /no stored image|not found/i.test(msg) ? 400 : 502;
    return NextResponse.json({ error: msg.slice(0, 300) }, { status });
  }
}
