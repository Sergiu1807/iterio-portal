import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import type { B3 } from "@/systems/brand-foundation/b3-schema";
import { getLatestBrandIntelligence } from "@/systems/brand-foundation/contract";
import { createDraft } from "@/systems/brand-foundation/versioning";

export const dynamic = "force-dynamic";

/** Start a new editable draft from the latest version (used by "Edit after approve"). */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const { brandId } = (await req.json()) as { brandId?: string };
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const latest = await getLatestBrandIntelligence(brandId);
  if (latest && latest.status === "draft") return NextResponse.json({ row: latest }); // already editable
  const base = (latest?.json as B3 | undefined) ?? {};
  const row = await createDraft(brandId, JSON.parse(JSON.stringify(base)) as B3);
  return NextResponse.json({ row });
}
