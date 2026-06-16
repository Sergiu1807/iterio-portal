import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getAllBrands, createBrandFromDraft } from "@/lib/brands";
import type { BrandDraft } from "@/lib/types";

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brands = await getAllBrands();
  return NextResponse.json({ brands });
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }
  const draft = (await req.json()) as BrandDraft;
  if (!draft?.name?.trim()) {
    return NextResponse.json({ error: "Brand name is required" }, { status: 400 });
  }
  const brand = await createBrandFromDraft(draft, auth.user.id);
  return NextResponse.json({ brand }, { status: 201 });
}
