import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { startGeneration } from "@/systems/static-generation/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    brandId?: string;
    referencePath?: string;
    productId?: string | null;
    adCopy?: string | null;
    aspectRatios?: string[];
    variationCount?: number;
    resolution?: string;
  };
  if (!body.brandId || !body.referencePath) {
    return NextResponse.json({ error: "brandId + referencePath required" }, { status: 400 });
  }

  try {
    const out = await startGeneration({
      brandId: body.brandId,
      referencePath: body.referencePath,
      productId: body.productId ?? null,
      adCopy: body.adCopy ?? null,
      aspectRatios: body.aspectRatios ?? ["1:1"],
      variationCount: body.variationCount ?? 1,
      resolution: body.resolution ?? "2K",
    });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
  }
}
