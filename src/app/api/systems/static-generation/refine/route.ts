import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { refineGeneration } from "@/systems/static-generation/refine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const { brandId, generationId, kind } = (await req.json().catch(() => ({}))) as {
    brandId?: string;
    generationId?: string;
    kind?: "product" | "logo";
  };
  if (!brandId || !generationId || (kind !== "product" && kind !== "logo")) {
    return NextResponse.json({ error: "brandId + generationId + kind(product|logo) required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await refineGeneration(brandId, generationId, kind));
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
  }
}
