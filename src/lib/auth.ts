import "server-only";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Role = "admin" | "member" | "viewer";

export type Profile = {
  id: string;
  email: string | null;
  role: Role;
  displayName: string | null;
  isActive: boolean;
};

export type AuthResult = {
  user: { id: string; email?: string };
  profile: Profile;
};

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "stephen@studio-flow.co")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Validates the Supabase session and returns the joined profile row.
 *  Auto-provisions a profile on first call if the signup trigger hasn't. */
export async function requireAuth(): Promise<AuthResult | NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let [profile] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, user.id))
    .limit(1);

  if (!profile) {
    const email = (user.email || "").toLowerCase();
    const role: Role = adminEmails().includes(email) ? "admin" : "viewer";
    await db
      .insert(schema.profiles)
      .values({ id: user.id, email: user.email ?? null, role })
      .onConflictDoNothing();
    [profile] = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, user.id))
      .limit(1);
  }

  if (!profile || !profile.isActive) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  profile = await ensureAdminRole(user.id, user.email, profile);

  return {
    user: { id: user.id, email: user.email ?? undefined },
    profile: profile as Profile,
  };
}

/** ADMIN_EMAILS is the source of truth: upgrade an allow-listed user to admin. */
async function ensureAdminRole<T extends { role: string }>(
  userId: string,
  email: string | undefined,
  profile: T
): Promise<T> {
  if (profile.role !== "admin" && adminEmails().includes((email || "").toLowerCase())) {
    await db.update(schema.profiles).set({ role: "admin" }).where(eq(schema.profiles.id, userId));
    return { ...profile, role: "admin" };
  }
  return profile;
}

export async function requireAdmin(): Promise<AuthResult | NextResponse> {
  const result = await requireAuth();
  if (isAuthError(result)) return result;
  if (result.profile.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return result;
}

export function isAuthError(result: AuthResult | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}

/** Page-friendly variant (returns null instead of a NextResponse) for gating
 *  Server Components with redirect(). */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let [profile] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, user.id))
    .limit(1);

  if (!profile) {
    const email = (user.email || "").toLowerCase();
    const role: Role = adminEmails().includes(email) ? "admin" : "viewer";
    await db
      .insert(schema.profiles)
      .values({ id: user.id, email: user.email ?? null, role })
      .onConflictDoNothing();
    [profile] = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, user.id))
      .limit(1);
  }

  if (!profile || !profile.isActive) return null;
  return (await ensureAdminRole(user.id, user.email ?? undefined, profile)) as Profile;
}
