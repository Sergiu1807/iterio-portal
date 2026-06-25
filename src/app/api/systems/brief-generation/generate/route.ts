import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { startBrief } from "@/systems/brief-generation/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { brandId?: string; angleId?: string; format?: string; depth?: string; notes?: string; referenceRef?: { kind: string; id: string; storageKey?: string | null } | null };
  if (!body.brandId || !body.angleId) return NextResponse.json({ error: "brandId + angleId required" }, { status: 400 });

  try {
    const out = await startBrief({ brandId: body.brandId, angleId: body.angleId, format: body.format, depth: body.depth, notes: body.notes, referenceRef: body.referenceRef ?? null });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
  }
}
