import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import type { B3 } from "@/systems/brand-foundation/b3-schema";
import { ensureDraft, saveDraftJson } from "@/systems/brand-foundation/versioning";

export const dynamic = "force-dynamic";

/** Set a value at a dot/bracket path (e.g. "positioning.statement", "personas.0.name"). */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: Record<string, unknown> | unknown[] = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const nextIsIndex = /^\d+$/.test(keys[i + 1]);
    const container = cur as Record<string, unknown>;
    if (container[k] == null || typeof container[k] !== "object") container[k] = nextIsIndex ? [] : {};
    cur = container[k] as Record<string, unknown> | unknown[];
  }
  (cur as Record<string, unknown>)[keys[keys.length - 1]] = value;
}

/** Latest version (or a specific one), creating a v1 draft if none exists. */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const u = new URL(req.url);
  const brandId = u.searchParams.get("brandId");
  const versionParam = u.searchParams.get("version");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  if (versionParam) {
    const [row] = await db
      .select()
      .from(schema.brandIntelligence)
      .where(and(eq(schema.brandIntelligence.brandId, brandId), eq(schema.brandIntelligence.version, Number(versionParam))))
      .limit(1);
    if (!row) return NextResponse.json({ error: "Version not found" }, { status: 404 });
    return NextResponse.json({ row });
  }

  const [brand] = await db.select({ name: schema.brands.name, category: schema.brands.category }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  const row = await ensureDraft(brandId, { name: brand.name, category: brand.category ?? undefined });
  return NextResponse.json({ row });
}

/** Patch a single JSON path on the current draft (optimistic version guard → 409). */
export async function PATCH(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const { brandId, version, path, value } = (await req.json()) as { brandId?: string; version?: number; path?: string; value?: unknown };
  if (!brandId || typeof version !== "number" || !path) return NextResponse.json({ error: "brandId, version, path required" }, { status: 400 });

  const [row] = await db
    .select()
    .from(schema.brandIntelligence)
    .where(and(eq(schema.brandIntelligence.brandId, brandId), eq(schema.brandIntelligence.version, version)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  if (row.status !== "draft") return NextResponse.json({ error: "This version is approved — edit creates a new draft." }, { status: 409 });

  const b3 = (row.json ?? {}) as B3 & Record<string, unknown>;
  setByPath(b3 as Record<string, unknown>, path, value);
  const saved = await saveDraftJson(brandId, version, b3 as B3);
  if (!saved) return NextResponse.json({ error: "Draft changed — reload." }, { status: 409 });
  return NextResponse.json({ row: saved });
}
