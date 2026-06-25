import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { startIdeation } from "@/systems/ideation/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    brandId?: string;
    productId?: string | null;
    objective?: string;
    funnelStage?: string;
    formats?: string[];
    count?: number;
    theme?: string;
  };
  if (!body.brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  try {
    const out = await startIdeation({
      brandId: body.brandId,
      productId: body.productId ?? null,
      objective: body.objective,
      funnelStage: body.funnelStage,
      formats: body.formats,
      count: body.count,
      theme: body.theme,
    });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
  }
}
