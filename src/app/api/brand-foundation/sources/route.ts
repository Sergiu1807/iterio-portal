import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

type SourceInput = { type: string; url?: string | null; handle?: string | null; config?: Record<string, unknown> };

/** List a brand's research sources (the onboarding inputs). */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  const sources = await db.select().from(schema.brandSources).where(eq(schema.brandSources.brandId, brandId));
  return NextResponse.json({ sources });
}

/** Replace the brand's input set (resumable; P1 has no jobs depending on these). */
export async function PUT(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const { brandId, sources } = (await req.json()) as { brandId?: string; sources?: SourceInput[] };
  if (!brandId || !Array.isArray(sources)) return NextResponse.json({ error: "brandId + sources[] required" }, { status: 400 });

  // dedupe by (type, url|handle); drop blank rows. Email is paste-based (config.text, no url/handle).
  const hasText = (s: SourceInput) => String((s.config as { text?: string } | undefined)?.text ?? "").trim().length > 0;
  const seen = new Set<string>();
  const clean = sources
    .filter((s) => s.type && (s.url?.trim() || s.handle?.trim() || hasText(s)))
    .filter((s) => {
      const k = `${s.type}:${(s.url ?? s.handle ?? "").trim().toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  await db.delete(schema.brandSources).where(eq(schema.brandSources.brandId, brandId));
  if (clean.length) {
    await db.insert(schema.brandSources).values(
      clean.map((s) => ({
        brandId,
        type: s.type,
        url: s.url?.trim() || null,
        handle: s.handle?.trim() || null,
        config: s.config ?? {},
        status: "idle",
      }))
    );
  }
  const saved = await db.select().from(schema.brandSources).where(eq(schema.brandSources.brandId, brandId));
  return NextResponse.json({ sources: saved });
}
