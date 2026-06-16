import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/auth";
import { getUsageRollup } from "@/lib/usage";

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 7));
  const rollup = await getUsageRollup(days);
  return NextResponse.json({ days, rollup });
}
