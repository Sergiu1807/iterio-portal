import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { listVersions } from "@/systems/brand-foundation/versioning";

export const dynamic = "force-dynamic";

/** Version history for a brand's Brand Intelligence. */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  const versions = await listVersions(brandId);
  return NextResponse.json({ versions });
}
