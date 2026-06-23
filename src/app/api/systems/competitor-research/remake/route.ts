import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { GateError, remakeStatic, remakeVideo } from "@/systems/competitor-research/remake";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // deep analysis + compose + gate + submit

/** Remake a winning concept into on-brand variants via the existing Static
 *  (Reference mode) or Video pipeline. Compliance-gated before anything generates. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = (await req.json()) as {
    brandId?: string;
    conceptId?: string;
    target?: "static" | "video";
    productId?: string | null;
    aspectRatios?: string[];
    aspectRatio?: string;
    variationCount?: number;
    resolution?: string;
    duration?: number;
  };
  const target = body.target === "video" ? "video" : "static";
  if (!body.brandId || !body.conceptId) {
    return NextResponse.json({ error: "brandId and conceptId are required" }, { status: 400 });
  }

  // concept (scoped to brand) → its Angle Bank entry → its representative ad
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
    const res =
      target === "video"
        ? await remakeVideo(body.brandId, ad, bank, {
            productId: body.productId ?? null,
            duration: body.duration,
            aspectRatio: body.aspectRatio,
            resolution: body.resolution,
            variationCount: body.variationCount,
          })
        : await remakeStatic(body.brandId, ad, bank, {
            productId: body.productId ?? null,
            aspectRatios: body.aspectRatios,
            variationCount: body.variationCount,
            resolution: body.resolution,
          });
    return NextResponse.json({ ...res, target });
  } catch (e) {
    if (e instanceof GateError) {
      return NextResponse.json({ error: "Blocked by the compliance gate.", failures: e.failures }, { status: 422 });
    }
    const msg = String((e as Error)?.message ?? e);
    // "Static system is not set up" / "no stored image" → a fixable 400, not a 500
    const status = /not set up|no stored image|not found/i.test(msg) ? 400 : 502;
    return NextResponse.json({ error: msg.slice(0, 300) }, { status });
  }
}
