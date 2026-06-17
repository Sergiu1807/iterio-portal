import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { storagePath, uploadToStorage, signedUrl, extFromContentType } from "@/lib/storage";
import { KIND_REFERENCES } from "@/systems/static-generation/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_REF_BYTES = 50 * 1024 * 1024;

/** The brand's reference-image library, with signed URLs. */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const rows = await db
    .select()
    .from(schema.staticReferences)
    .where(eq(schema.staticReferences.brandId, brandId))
    .orderBy(desc(schema.staticReferences.createdAt));

  const references = await Promise.all(
    rows.map(async (r) => ({ id: r.id, name: r.name, imagePath: r.imagePath, url: await signedUrl(r.imagePath), createdAt: r.createdAt }))
  );
  return NextResponse.json({ references });
}

/** Upload an image into the brand's reference library. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const form = await req.formData().catch((e) => {
    console.warn("[static/references] formData parse failed:", e);
    return null;
  });
  const brandId = form?.get("brandId");
  const file = form?.get("file") as (Blob & { name?: string; type?: string }) | null;
  const name = (form?.get("name") as string) || null;
  const isFile = !!file && typeof file.arrayBuffer === "function";
  if (typeof brandId !== "string" || !brandId || !isFile) {
    return NextResponse.json({ error: "brandId + file required" }, { status: 400 });
  }
  const contentType = file.type || "image/png";
  if (!contentType.startsWith("image/")) return NextResponse.json({ error: "image files only" }, { status: 400 });
  if (file.size > MAX_REF_BYTES) return NextResponse.json({ error: "image too large (max 50MB)" }, { status: 400 });

  const [brand] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const buf = Buffer.from(await file.arrayBuffer());
  const path = storagePath(brand.slug, KIND_REFERENCES, `${randomUUID()}.${extFromContentType(contentType)}`);
  await uploadToStorage(path, buf, contentType);

  const [row] = await db
    .insert(schema.staticReferences)
    .values({ brandId, name: name || file.name || "Reference", imagePath: path })
    .returning();

  return NextResponse.json({ id: row.id, imagePath: path, url: await signedUrl(path), name: row.name });
}

/** Remove a reference from the library. */
export async function DELETE(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const brandId = url.searchParams.get("brandId");
  if (!id || !brandId) return NextResponse.json({ error: "id + brandId required" }, { status: 400 });
  await db.delete(schema.staticReferences).where(and(eq(schema.staticReferences.id, id), eq(schema.staticReferences.brandId, brandId)));
  return NextResponse.json({ ok: true });
}
