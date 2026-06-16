import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getConfiguredKeyNames } from "@/lib/api-keys";

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const configuredKeys = await getConfiguredKeyNames();
  return NextResponse.json({
    role: auth.profile.role,
    email: auth.profile.email,
    displayName: auth.profile.displayName,
    configuredKeys,
  });
}
