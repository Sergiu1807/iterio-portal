import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { storagePath, uploadToStorage, signedUrl, extFromContentType } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024;
const KIND_ASSETS = "brand-assets";
const ASSET_TYPES = ["logo", "font", "palette", "brand_book", "product_photo", "packaging", "winning_creative"];

/** List a brand's foundation assets with fresh signed URLs. */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  const rows = await db
    .select()
    .from(schema.brandAssets)
    .where(eq(schema.brandAssets.brandId, brandId))
    .orderBy(desc(schema.brandAssets.createdAt));
  const assets = await Promise.all(rows.map(async (a) => ({ ...a, url: await signedUrl(a.storageKey) })));
  return NextResponse.json({ assets });
}

/** Upload a brand asset (logo / brand book / product photo / winning creative / …). */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const form = await req.formData().catch((e) => {
    console.warn("[brand-foundation/assets] formData parse failed:", e);
    return null;
  });
  const brandId = form?.get("brandId");
  const type = String(form?.get("type") ?? "");
  const file = form?.get("file") as (Blob & { type?: string; name?: string }) | null;
  const isFile = !!file && typeof file.arrayBuffer === "function";
  if (typeof brandId !== "string" || !brandId || !isFile) return NextResponse.json({ error: "brandId + file required" }, { status: 400 });
  if (!ASSET_TYPES.includes(type)) return NextResponse.json({ error: "invalid asset type" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large (max 50MB)" }, { status: 400 });

  const [brand] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const contentType = file.type || "application/octet-stream";
  const ext = contentType.startsWith("image/") ? extFromContentType(contentType) : (file.name?.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const filename = `${type}-${Date.now().toString(36)}.${ext}`;
  const key = storagePath(brand.slug, KIND_ASSETS, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  await uploadToStorage(key, buf, contentType);

  const [row] = await db
    .insert(schema.brandAssets)
    .values({ brandId, type, storageKey: key, meta: { origin: "operator_upload", filename: file.name ?? filename, contentType } })
    .returning({ id: schema.brandAssets.id });

  return NextResponse.json({ id: row.id, url: await signedUrl(key) }, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id, brandId } = (await req.json()) as { id?: string; brandId?: string };
  if (!id || !brandId) return NextResponse.json({ error: "id + brandId required" }, { status: 400 });
  await db.delete(schema.brandAssets).where(and(eq(schema.brandAssets.id, id), eq(schema.brandAssets.brandId, brandId)));
  return NextResponse.json({ ok: true });
}
