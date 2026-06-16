import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { storagePath, uploadToStorage, signedUrl, extFromContentType } from "@/lib/storage";
import { ensureStaticConfig } from "@/systems/static-generation/setup";
import { KIND_BRAND } from "@/systems/static-generation/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_LOGO_BYTES = 8 * 1024 * 1024;

/** Upload (or replace) the brand logo used by the "Refine logo" pass + Brief mode. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const brandId = form?.get("brandId");
  const file = form?.get("file");
  if (typeof brandId !== "string" || !brandId || !(file instanceof File)) {
    return NextResponse.json({ error: "brandId + file required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "image files only" }, { status: 400 });
  if (file.size > MAX_LOGO_BYTES) return NextResponse.json({ error: "logo too large (max 8MB)" }, { status: 400 });

  const [brand] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  await ensureStaticConfig(brandId);
  const buf = Buffer.from(await file.arrayBuffer());
  const path = storagePath(brand.slug, KIND_BRAND, `logo.${extFromContentType(file.type)}`);
  await uploadToStorage(path, buf, file.type);
  await db.update(schema.staticAdConfig).set({ brandLogoPath: path, updatedAt: new Date() }).where(eq(schema.staticAdConfig.brandId, brandId));

  return NextResponse.json({ logoUrl: await signedUrl(path) });
}

/** Remove the brand logo. */
export async function DELETE(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  await db.update(schema.staticAdConfig).set({ brandLogoPath: null, updatedAt: new Date() }).where(eq(schema.staticAdConfig.brandId, brandId));
  return NextResponse.json({ ok: true });
}
