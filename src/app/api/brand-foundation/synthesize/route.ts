import { NextResponse, after } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { synthesizeB3 } from "@/systems/brand-foundation/synthesis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Force a B3 draft from whatever extractions are complete (partial allowed). */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { brandId } = (await req.json()) as { brandId?: string };
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  after(() => synthesizeB3(brandId).catch((e) => console.warn("[brand-foundation] synthesize failed", e)));
  return NextResponse.json({ started: true }, { status: 202 });
}
