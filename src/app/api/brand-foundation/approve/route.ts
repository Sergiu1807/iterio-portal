import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { approveVersion } from "@/systems/brand-foundation/versioning";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // write-through touches several tables

/** Approve a B3 version → lock it + project into the legacy brand model. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const { brandId, version } = (await req.json()) as { brandId?: string; version?: number };
  if (!brandId || typeof version !== "number") return NextResponse.json({ error: "brandId + version required" }, { status: 400 });

  try {
    const row = await approveVersion(brandId, version, auth.profile.id);
    return NextResponse.json({ row });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 400 });
  }
}
