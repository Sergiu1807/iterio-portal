import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { storagePath, uploadToStorage, signedUrl, extFromContentType } from "@/lib/storage";
import { KIND_SCENES } from "@/systems/video-generation/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;

/** The brand's scene library, with signed URLs. */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const rows = await db.select().from(schema.videoScenes).where(eq(schema.videoScenes.brandId, brandId)).orderBy(desc(schema.videoScenes.createdAt));
  const items = await Promise.all(
    rows.map(async (r) => ({ id: r.id, name: r.name, description: r.description, imagePath: r.imagePath, url: await signedUrl(r.imagePath), createdAt: r.createdAt }))
  );
  return NextResponse.json({ items });
}

/** Upload a scene/background reference image. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const brandId = form?.get("brandId");
  const file = form?.get("file");
  const name = (form?.get("name") as string) || null;
  const description = (form?.get("description") as string) || null;
  if (typeof brandId !== "string" || !brandId || !(file instanceof File)) {
    return NextResponse.json({ error: "brandId + file required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "image files only" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "image too large (max 15MB)" }, { status: 400 });

  const [brand] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const buf = Buffer.from(await file.arrayBuffer());
  const path = storagePath(brand.slug, KIND_SCENES, `${randomUUID()}.${extFromContentType(file.type)}`);
  await uploadToStorage(path, buf, file.type);

  const [row] = await db
    .insert(schema.videoScenes)
    .values({ brandId, name: name || file.name || "Scene", description, imagePath: path })
    .returning();
  return NextResponse.json({ id: row.id, name: row.name, description: row.description, imagePath: path, url: await signedUrl(path) });
}

/** Remove a scene. */
export async function DELETE(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const brandId = url.searchParams.get("brandId");
  if (!id || !brandId) return NextResponse.json({ error: "id + brandId required" }, { status: 400 });
  await db.delete(schema.videoScenes).where(and(eq(schema.videoScenes.id, id), eq(schema.videoScenes.brandId, brandId)));
  return NextResponse.json({ ok: true });
}
