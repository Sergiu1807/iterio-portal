import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { advanceBrandGenerations } from "@/systems/static-generation/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** UI-driven: advance this brand's in-flight generations (cron is the backstop). */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const { brandId } = (await req.json().catch(() => ({}))) as { brandId?: string };
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const advanced = await advanceBrandGenerations(brandId, 8);
  return NextResponse.json({ advanced });
}
