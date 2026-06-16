import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { signedUrl, downloadFromStorage, uploadToStorage, storagePath } from "@/lib/storage";
import { submitGptImage2, GPT_IMAGE_2_MODEL, REFINE_PROMPT_PRODUCT, REFINE_PROMPT_LOGO } from "@/lib/providers/kie";
import { KIE_INPUT_EXPIRY, KIND_REFERENCES } from "./constants";

type GenRow = typeof schema.staticAdGenerations.$inferSelect;

async function loadCompleted(brandId: string, generationId: string): Promise<GenRow> {
  const [row] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(and(eq(schema.staticAdGenerations.id, generationId), eq(schema.staticAdGenerations.brandId, brandId)))
    .limit(1);
  if (!row) throw new Error("Generation not found");
  if (row.status !== "completed" || !row.imagePath) throw new Error("Only completed images can be refined");
  return row;
}

/**
 * Manual refine via GPT Image 2 image-to-image:
 *  - "product": [ad image, product image] + "swap the product"
 *  - "logo":    [ad image, brand logo]  + "replace the wordmark with this logo"
 * Creates a new 'refined' row that polls through the same chain.
 */
export async function refineGeneration(brandId: string, generationId: string, kind: "product" | "logo"): Promise<{ id: string }> {
  const source = await loadCompleted(brandId, generationId);

  let secondPath: string | null = null;
  let prompt: string;
  if (kind === "product") {
    if (!source.productId) throw new Error("This ad has no product to refine against");
    const [p] = await db.select().from(schema.products).where(and(eq(schema.products.id, source.productId), eq(schema.products.brandId, brandId))).limit(1);
    if (!p?.imageUrl) throw new Error("The product has no image to refine against");
    secondPath = p.imageUrl;
    prompt = REFINE_PROMPT_PRODUCT;
  } else {
    const [config] = await db.select().from(schema.staticAdConfig).where(eq(schema.staticAdConfig.brandId, brandId)).limit(1);
    if (!config?.brandLogoPath) throw new Error("Upload a brand logo first (Settings)");
    secondPath = config.brandLogoPath;
    prompt = REFINE_PROMPT_LOGO;
  }

  const [row] = await db
    .insert(schema.staticAdGenerations)
    .values({
      brandId,
      productId: source.productId,
      mode: "refined",
      status: "pending",
      kieModel: GPT_IMAGE_2_MODEL,
      aspectRatio: source.aspectRatio,
      resolution: source.resolution,
      outputFormat: "png",
      finalPrompt: prompt,
      referencePath: source.imagePath,
      sourceGenerationId: source.id,
      batchId: randomUUID(),
      batchIndex: 1,
      batchSize: 1,
    })
    .returning({ id: schema.staticAdGenerations.id });

  try {
    const inputUrls = [await signedUrl(source.imagePath, KIE_INPUT_EXPIRY), await signedUrl(secondPath, KIE_INPUT_EXPIRY)].filter(Boolean) as string[];
    const taskId = await submitGptImage2({ prompt, inputUrls, aspectRatio: source.aspectRatio, resolution: source.resolution });
    await db.update(schema.staticAdGenerations).set({ status: "generating", kieJobId: taskId, attempts: 1, updatedAt: new Date() }).where(eq(schema.staticAdGenerations.id, row.id));
  } catch (e) {
    await db.update(schema.staticAdGenerations).set({ status: "error", errorMessage: String((e as Error)?.message ?? e).slice(0, 300), updatedAt: new Date() }).where(eq(schema.staticAdGenerations.id, row.id));
  }
  return { id: row.id };
}

/** Copy a completed ad into the brand's reference library. */
export async function saveAsReference(brandId: string, generationId: string): Promise<{ id: string }> {
  const source = await loadCompleted(brandId, generationId);
  const [brand] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  if (!brand) throw new Error("Brand not found");

  const ext = source.imagePath!.split(".").pop() || "png";
  const buf = await downloadFromStorage(source.imagePath!);
  const path = storagePath(brand.slug, KIND_REFERENCES, `${randomUUID()}.${ext}`);
  await uploadToStorage(path, buf, ext === "png" ? "image/png" : "image/jpeg");

  const [row] = await db
    .insert(schema.staticReferences)
    .values({ brandId, name: "Saved generation", imagePath: path })
    .returning({ id: schema.staticReferences.id });
  return { id: row.id };
}
