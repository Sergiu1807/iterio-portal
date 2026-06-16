import { NextResponse, after } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getBrandById } from "@/lib/brands";
import { beginStaticSetup, runStaticSetup } from "@/systems/static-generation/setup";

export const dynamic = "force-dynamic";
export const maxDuration = 800; // research + 2 Claude authoring passes (Fluid compute)

/** Kick the per-brand prompt builder: research website → enrich intel → author
 *  Agent 1/2 prompts. Returns immediately; heavy work runs in after(). */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const { brandId } = (await req.json().catch(() => ({}))) as { brandId?: string };
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const brand = await getBrandById(brandId);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const config = await beginStaticSetup(brandId);
  after(() => runStaticSetup(brandId).catch((e) => console.warn("[static-setup] after() failed", e)));
  return NextResponse.json({ status: config.status });
}
