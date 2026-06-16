import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { startBriefGeneration } from "@/systems/static-generation/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    brandId?: string;
    briefText?: string;
    aspectRatios?: string[];
    variationCount?: number;
    resolution?: string;
  };
  if (!body.brandId || !body.briefText?.trim()) {
    return NextResponse.json({ error: "brandId + briefText required" }, { status: 400 });
  }

  try {
    const out = await startBriefGeneration({
      brandId: body.brandId,
      briefText: body.briefText,
      aspectRatios: body.aspectRatios ?? ["1:1"],
      variationCount: body.variationCount ?? 1,
      resolution: body.resolution ?? "2K",
    });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
  }
}
