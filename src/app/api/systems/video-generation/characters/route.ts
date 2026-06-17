import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { storagePath, uploadToStorage, signedUrl, extFromContentType } from "@/lib/storage";
import { KIND_CHARACTERS } from "@/systems/video-generation/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024;

/** The brand's character library, with signed URLs. */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const rows = await db.select().from(schema.videoCharacters).where(eq(schema.videoCharacters.brandId, brandId)).orderBy(desc(schema.videoCharacters.createdAt));
  const items = await Promise.all(
    rows.map(async (r) => ({ id: r.id, name: r.name, description: r.description, imagePath: r.imagePath, url: await signedUrl(r.imagePath), createdAt: r.createdAt }))
  );
  return NextResponse.json({ items });
}

/** Upload a character reference image. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const form = await req.formData().catch((e) => {
    console.warn("[video/characters] formData parse failed:", e);
    return null;
  });
  const brandId = form?.get("brandId");
  const file = form?.get("file") as (Blob & { name?: string; type?: string }) | null;
  const name = (form?.get("name") as string) || null;
  const description = (form?.get("description") as string) || null;
  // Duck-type the file (a Blob has arrayBuffer()) — `instanceof File` can be a
  // false negative under Turbopack (cross-realm) which yields this 400.
  const isFile = !!file && typeof file.arrayBuffer === "function";
  if (typeof brandId !== "string" || !brandId || !isFile) {
    console.warn("[video/characters] bad upload:", { hasForm: !!form, brandId: typeof brandId, file: file ? (file as { constructor?: { name?: string } }).constructor?.name : "missing" });
    return NextResponse.json({ error: "brandId + file required" }, { status: 400 });
  }
  const contentType = file.type || "image/png";
  if (!contentType.startsWith("image/")) return NextResponse.json({ error: "image files only" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "image too large (max 50MB)" }, { status: 400 });

  const [brand] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const buf = Buffer.from(await file.arrayBuffer());
  const path = storagePath(brand.slug, KIND_CHARACTERS, `${randomUUID()}.${extFromContentType(contentType)}`);
  await uploadToStorage(path, buf, contentType);

  const [row] = await db
    .insert(schema.videoCharacters)
    .values({ brandId, name: name || file.name || "Character", description, imagePath: path })
    .returning();
  return NextResponse.json({ id: row.id, name: row.name, description: row.description, imagePath: path, url: await signedUrl(path) });
}

/** Remove a character. */
export async function DELETE(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const brandId = url.searchParams.get("brandId");
  if (!id || !brandId) return NextResponse.json({ error: "id + brandId required" }, { status: 400 });
  await db.delete(schema.videoCharacters).where(and(eq(schema.videoCharacters.id, id), eq(schema.videoCharacters.brandId, brandId)));
  return NextResponse.json({ ok: true });
}
