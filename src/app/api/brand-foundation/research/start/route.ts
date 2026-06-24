import { NextResponse, after } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { startOnboarding } from "@/systems/brand-foundation/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Kick off automated research across the brand's sources (runs detached). */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { brandId } = (await req.json()) as { brandId?: string };
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  after(() => startOnboarding(brandId).catch((e) => console.warn("[brand-foundation] start failed", e)));
  return NextResponse.json({ started: true }, { status: 202 });
}
