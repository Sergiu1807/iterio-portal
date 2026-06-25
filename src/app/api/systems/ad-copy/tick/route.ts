import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { runCopyTick } from "@/systems/ad-copy/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { brandId } = (await req.json().catch(() => ({}))) as { brandId?: string };
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  const advanced = await runCopyTick(brandId);
  return NextResponse.json({ advanced });
}
