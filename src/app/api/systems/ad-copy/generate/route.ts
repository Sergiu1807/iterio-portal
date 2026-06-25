import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { startCopy } from "@/systems/ad-copy/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { brandId?: string; angleId?: string | null; briefId?: string | null; placement?: string; variantCount?: number; funnelStage?: string };
  if (!body.brandId || (!body.angleId && !body.briefId)) return NextResponse.json({ error: "brandId + angleId or briefId required" }, { status: 400 });
  try {
    const out = await startCopy({ brandId: body.brandId, angleId: body.angleId ?? null, briefId: body.briefId ?? null, placement: body.placement, variantCount: body.variantCount, funnelStage: body.funnelStage });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
  }
}
