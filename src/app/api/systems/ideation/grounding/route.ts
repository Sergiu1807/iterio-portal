import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { buildBrandGrounding } from "@/lib/brand-grounding";

export const dynamic = "force-dynamic";

/** Lightweight: what this brand's Ideation will ground on (B3 vN / flat / none). */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  const g = await buildBrandGrounding(brandId);
  return NextResponse.json({ source: g.source, version: g.version, hasCompliance: g.compliance.banned_phrasings.length > 0 || g.compliance.rules.length > 0, personaCount: g.personas.length });
}
