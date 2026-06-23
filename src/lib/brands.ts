import "server-only";
import { eq, inArray, asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Brand, BrandDraft } from "@/lib/types";
import { slugify } from "@/lib/utils";
import { signedUrl } from "@/lib/storage";

// ---- mapping: normalized rows → the Brand domain object the UI expects ----

type BrandRow = typeof schema.brands.$inferSelect;

function mapBrand(
  row: BrandRow,
  subs: {
    sections: (typeof schema.intelligenceSections.$inferSelect)[];
    products: (typeof schema.products.$inferSelect)[];
    personas: (typeof schema.personas.$inferSelect)[];
    usps: (typeof schema.usps.$inferSelect)[];
    competitors: (typeof schema.competitors.$inferSelect)[];
  }
): Brand {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    website: row.website ?? undefined,
    category: row.category ?? undefined,
    primaryMarket: row.primaryMarket ?? undefined,
    currency: row.currency ?? undefined,
    tagline: row.tagline ?? undefined,
    vibe: row.vibe ?? undefined,
    brandColor: row.brandColor,
    palette: row.palette ?? [],
    fonts: row.fonts ?? {},
    cluster: row.cluster ?? undefined,
    status: (row.status as Brand["status"]) ?? "Active",
    onboardingSource: (row.onboardingSource as Brand["onboardingSource"]) ?? undefined,
    enabledSystems: row.enabledSystems ?? {},
    createdAt: row.createdAt.toISOString(),
    sections: subs.sections
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({ id: s.id, title: s.title, sectionType: s.sectionType ?? "custom", content: s.content ?? "", sortOrder: s.sortOrder })),
    products: subs.products.map((p) => ({ id: p.id, name: p.name, category: p.category ?? undefined, keyBenefits: p.keyBenefits ?? undefined, price: p.price ?? undefined, productUrl: p.productUrl ?? undefined, imageUrl: p.imageUrl ?? undefined, videoImageUrl: p.videoImageUrl ?? undefined, isHero: p.isHero })),
    personas: subs.personas.map((p) => ({ id: p.id, name: p.name, demographics: p.demographics ?? undefined, psychographics: p.psychographics ?? undefined, painPoints: p.painPoints ?? undefined, desires: p.desires ?? undefined })),
    usps: subs.usps.map((u) => ({ id: u.id, text: u.text, category: u.category ?? undefined, isPrimary: u.isPrimary })),
    competitors: subs.competitors.map((c) => ({ id: c.id, name: c.name, websiteUrl: c.websiteUrl ?? undefined, instagramHandle: c.instagramHandle ?? undefined, tiktokHandle: c.tiktokHandle ?? undefined, type: c.type ?? undefined })),
    creativeDna: [],
  };
}

export async function getAllBrands(): Promise<Brand[]> {
  const rows = await db.select().from(schema.brands).orderBy(asc(schema.brands.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [sections, products, personas, usps, competitors] = await Promise.all([
    db.select().from(schema.intelligenceSections).where(inArray(schema.intelligenceSections.brandId, ids)),
    db.select().from(schema.products).where(inArray(schema.products.brandId, ids)),
    db.select().from(schema.personas).where(inArray(schema.personas.brandId, ids)),
    db.select().from(schema.usps).where(inArray(schema.usps.brandId, ids)),
    db.select().from(schema.competitors).where(inArray(schema.competitors.brandId, ids)),
  ]);
  const by = <T extends { brandId: string }>(arr: T[], id: string) => arr.filter((x) => x.brandId === id);
  return rows.map((row) =>
    mapBrand(row, {
      sections: by(sections, row.id),
      products: by(products, row.id),
      personas: by(personas, row.id),
      usps: by(usps, row.id),
      competitors: by(competitors, row.id),
    })
  );
}

/** Fresh signed display URLs for a brand's product images, keyed by product id.
 *  Paths live in the DB (products.image_url / video_image_url); the private
 *  bucket means the UI can only render time-limited signed URLs, so we resolve
 *  them on demand here rather than polluting the persisted Brand object. */
export type ProductMediaMap = Record<string, { image: string | null; video: string | null; name: string; isHero: boolean }>;

export async function getBrandProductMedia(brandId: string): Promise<ProductMediaMap> {
  const rows = await db
    .select({ id: schema.products.id, name: schema.products.name, isHero: schema.products.isHero, imageUrl: schema.products.imageUrl, videoImageUrl: schema.products.videoImageUrl })
    .from(schema.products)
    .where(eq(schema.products.brandId, brandId));
  const entries = await Promise.all(
    rows.map(async (r) => [r.id, { image: await signedUrl(r.imageUrl), video: await signedUrl(r.videoImageUrl), name: r.name, isHero: r.isHero }] as const)
  );
  return Object.fromEntries(entries);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || `brand-${Date.now().toString(36)}`;
  let slug = root;
  let n = 1;
  while ((await db.select({ id: schema.brands.id }).from(schema.brands).where(eq(schema.brands.slug, slug))).length) {
    slug = `${root}-${++n}`;
  }
  return slug;
}

export async function createBrandFromDraft(draft: BrandDraft, ownerId?: string): Promise<Brand> {
  const slug = await uniqueSlug(draft.name);
  const [brand] = await db
    .insert(schema.brands)
    .values({
      ownerId: ownerId ?? null,
      name: draft.name,
      slug,
      website: draft.website ?? null,
      category: draft.category ?? null,
      primaryMarket: draft.primaryMarket ?? null,
      currency: draft.currency ?? null,
      tagline: draft.tagline ?? null,
      vibe: draft.vibe ?? null,
      brandColor: draft.brandColor || "#5A7A64",
      palette: draft.palette?.length ? draft.palette : [{ hex: draft.brandColor || "#5A7A64", role: "primary" }],
      cluster: draft.cluster ?? null,
      status: "Active",
      onboardingSource: draft.onboardingSource,
      enabledSystems: { "brief-generation": true, "static-generation": false, "video-generation": false, "competitor-research": false },
      storagePrefix: slug,
    })
    .returning();

  if (draft.sections.length)
    await db.insert(schema.intelligenceSections).values(
      draft.sections.map((s, i) => ({ brandId: brand.id, title: s.title, sectionType: s.sectionType, content: s.content, sortOrder: s.sortOrder ?? i }))
    );
  if (draft.products.length)
    await db.insert(schema.products).values(draft.products.map((p) => ({ brandId: brand.id, name: p.name, category: p.category ?? null, keyBenefits: p.keyBenefits ?? null, price: p.price ?? null, productUrl: p.productUrl ?? null, imageUrl: p.imageUrl ?? null, videoImageUrl: p.videoImageUrl ?? null, isHero: p.isHero ?? false })));
  if (draft.personas.length)
    await db.insert(schema.personas).values(draft.personas.map((p) => ({ brandId: brand.id, name: p.name, demographics: p.demographics ?? null, psychographics: p.psychographics ?? null, painPoints: p.painPoints ?? null, desires: p.desires ?? null })));
  if (draft.usps.length)
    await db.insert(schema.usps).values(draft.usps.map((u) => ({ brandId: brand.id, text: u.text, category: u.category ?? null, isPrimary: u.isPrimary ?? false })));
  if (draft.competitors.length)
    await db.insert(schema.competitors).values(draft.competitors.map((c) => ({ brandId: brand.id, name: c.name, websiteUrl: c.websiteUrl ?? null, instagramHandle: c.instagramHandle ?? null, tiktokHandle: c.tiktokHandle ?? null, type: c.type ?? null })));

  return (await getBrandById(brand.id))!;
}

export async function getBrandById(id: string): Promise<Brand | null> {
  const [row] = await db.select().from(schema.brands).where(eq(schema.brands.id, id)).limit(1);
  if (!row) return null;
  const [sections, products, personas, usps, competitors] = await Promise.all([
    db.select().from(schema.intelligenceSections).where(eq(schema.intelligenceSections.brandId, id)),
    db.select().from(schema.products).where(eq(schema.products.brandId, id)),
    db.select().from(schema.personas).where(eq(schema.personas.brandId, id)),
    db.select().from(schema.usps).where(eq(schema.usps.brandId, id)),
    db.select().from(schema.competitors).where(eq(schema.competitors.brandId, id)),
  ]);
  return mapBrand(row, { sections, products, personas, usps, competitors });
}

/** Apply a partial Brand patch: scalar columns update the brands row; any
 *  sub-resource array present is fully replaced for that brand (single-owner
 *  lab → low write volume, keeps the existing UI's "send full array" model). */
export async function updateBrandRecord(id: string, patch: Partial<Brand>): Promise<Brand | null> {
  const scalar: Record<string, unknown> = {};
  for (const k of ["name", "website", "category", "primaryMarket", "currency", "tagline", "vibe", "brandColor", "palette", "fonts", "cluster", "status", "enabledSystems"] as const) {
    if (k in patch) scalar[k] = (patch as Record<string, unknown>)[k];
  }
  if (Object.keys(scalar).length) {
    scalar.updatedAt = new Date();
    await db.update(schema.brands).set(scalar).where(eq(schema.brands.id, id));
  }

  if (patch.sections) {
    await db.delete(schema.intelligenceSections).where(eq(schema.intelligenceSections.brandId, id));
    if (patch.sections.length)
      await db.insert(schema.intelligenceSections).values(patch.sections.map((s, i) => ({ brandId: id, title: s.title, sectionType: s.sectionType, content: s.content, sortOrder: s.sortOrder ?? i })));
  }
  if (patch.products) {
    await db.delete(schema.products).where(eq(schema.products.brandId, id));
    if (patch.products.length)
      await db.insert(schema.products).values(patch.products.map((p) => ({ brandId: id, name: p.name, category: p.category ?? null, keyBenefits: p.keyBenefits ?? null, price: p.price ?? null, productUrl: p.productUrl ?? null, imageUrl: p.imageUrl ?? null, videoImageUrl: p.videoImageUrl ?? null, isHero: p.isHero ?? false })));
  }
  if (patch.personas) {
    await db.delete(schema.personas).where(eq(schema.personas.brandId, id));
    if (patch.personas.length)
      await db.insert(schema.personas).values(patch.personas.map((p) => ({ brandId: id, name: p.name, demographics: p.demographics ?? null, psychographics: p.psychographics ?? null, painPoints: p.painPoints ?? null, desires: p.desires ?? null })));
  }
  if (patch.usps) {
    await db.delete(schema.usps).where(eq(schema.usps.brandId, id));
    if (patch.usps.length)
      await db.insert(schema.usps).values(patch.usps.map((u) => ({ brandId: id, text: u.text, category: u.category ?? null, isPrimary: u.isPrimary ?? false })));
  }
  if (patch.competitors) {
    await db.delete(schema.competitors).where(eq(schema.competitors.brandId, id));
    if (patch.competitors.length)
      await db.insert(schema.competitors).values(patch.competitors.map((c) => ({ brandId: id, name: c.name, websiteUrl: c.websiteUrl ?? null, instagramHandle: c.instagramHandle ?? null, tiktokHandle: c.tiktokHandle ?? null, type: c.type ?? null })));
  }

  return getBrandById(id);
}

export async function deleteBrandRecord(id: string): Promise<void> {
  await db.delete(schema.brands).where(eq(schema.brands.id, id));
}
