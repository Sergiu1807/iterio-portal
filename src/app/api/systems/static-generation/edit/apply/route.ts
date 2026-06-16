import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { applyEdit } from "@/systems/static-generation/edit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const { brandId, generationId, edits } = (await req.json().catch(() => ({}))) as {
    brandId?: string;
    generationId?: string;
    edits?: { original: string; replacement: string }[];
  };
  if (!brandId || !generationId || !Array.isArray(edits)) {
    return NextResponse.json({ error: "brandId + generationId + edits[] required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await applyEdit(brandId, generationId, edits));
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
  }
}
