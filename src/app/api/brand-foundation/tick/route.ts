import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { runOnboardingTick } from "@/systems/brand-foundation/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** UI-driven advance while the operator watches (cron is the backstop). */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { brandId } = (await req.json()) as { brandId?: string };
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  await runOnboardingTick(brandId);
  return NextResponse.json({ ok: true });
}
