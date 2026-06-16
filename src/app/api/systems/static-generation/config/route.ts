import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Read the brand's static-ad config (null if not set up yet). */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const [row] = await db.select().from(schema.staticAdConfig).where(eq(schema.staticAdConfig.brandId, brandId)).limit(1);
  if (!row) return NextResponse.json({ config: null });

  return NextResponse.json({
    config: {
      status: row.status,
      isPlaceholder: row.isPlaceholder,
      builtAt: row.builtAt,
      buildError: row.buildError,
      agent1Prompt: row.agent1Prompt,
      agent2Prompt: row.agent2Prompt,
      briefAgent1Prompt: row.briefAgent1Prompt,
      briefAgent2Prompt: row.briefAgent2Prompt,
      hasLogo: !!row.brandLogoPath,
      logoUrl: await signedUrl(row.brandLogoPath),
    },
  });
}

/** Edit the agent prompts by hand (marks the config as a ready, non-placeholder build). */
export async function PATCH(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    brandId?: string;
    agent1Prompt?: string;
    agent2Prompt?: string;
    briefAgent1Prompt?: string;
    briefAgent2Prompt?: string;
  };
  if (!body.brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["agent1Prompt", "agent2Prompt", "briefAgent1Prompt", "briefAgent2Prompt"] as const) {
    if (typeof body[k] === "string") patch[k] = body[k];
  }
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  patch.status = "ready";
  patch.isPlaceholder = false;

  const [row] = await db
    .update(schema.staticAdConfig)
    .set(patch)
    .where(eq(schema.staticAdConfig.brandId, body.brandId))
    .returning();
  if (!row) return NextResponse.json({ error: "Not set up yet" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
