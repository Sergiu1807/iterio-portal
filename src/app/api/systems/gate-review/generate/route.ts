import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { startGateReview } from "@/systems/gate-review/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { brandId?: string; sourceSystem?: string; sourceId?: string | null; assetPath?: string | null; copyText?: string | null };
  if (!body.brandId || (!body.sourceId && !body.assetPath)) return NextResponse.json({ error: "brandId + (sourceId or assetPath) required" }, { status: 400 });
  try {
    const out = await startGateReview({ brandId: body.brandId, sourceSystem: body.sourceSystem, sourceId: body.sourceId ?? null, assetPath: body.assetPath ?? null, copyText: body.copyText ?? null });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
  }
}
