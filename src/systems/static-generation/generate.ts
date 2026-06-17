import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { signedUrl } from "@/lib/storage";
import { submitNanoBanana, NANO_BANANA_MODEL } from "@/lib/providers/kie";
import { analyzeReference, analyzeBrief, composePrompt, type ProductContext } from "./pipeline";
import { KIE_INPUT_EXPIRY, MAX_VARIATIONS } from "./constants";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n | 0));

type ConfigRow = typeof schema.staticAdConfig.$inferSelect;

async function loadConfig(brandId: string): Promise<ConfigRow> {
  const [config] = await db.select().from(schema.staticAdConfig).where(eq(schema.staticAdConfig.brandId, brandId)).limit(1);
  if (!config) throw new Error("Static system is not set up for this brand yet.");
  return config;
}

async function loadProduct(brandId: string, productId?: string | null): Promise<ProductContext | null> {
  if (!productId) return null;
  const [p] = await db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.id, productId), eq(schema.products.brandId, brandId)))
    .limit(1);
  if (!p) return null;
  return { name: p.name, imagePath: p.imageUrl, category: p.category, keyBenefits: p.keyBenefits };
}

/** Submit one cell (insert row → Nano Banana → mark generating / error). */
async function submitCell(opts: {
  brandId: string;
  productId: string | null;
  mode: "custom" | "brief";
  aspectRatio: string;
  resolution: string;
  finalPrompt: string;
  analysisJson: string;
  referencePath: string | null;
  adCopy: string | null;
  batchId: string;
  batchIndex: number;
  batchSize: number;
  inputUrls: string[];
}): Promise<string> {
  const [row] = await db
    .insert(schema.staticAdGenerations)
    .values({
      brandId: opts.brandId,
      productId: opts.productId,
      mode: opts.mode,
      status: "pending",
      kieModel: NANO_BANANA_MODEL,
      aspectRatio: opts.aspectRatio,
      resolution: opts.resolution,
      outputFormat: "png",
      finalPrompt: opts.finalPrompt,
      analysisJson: opts.analysisJson,
      referencePath: opts.referencePath,
      adCopy: opts.adCopy,
      batchId: opts.batchId,
      batchIndex: opts.batchIndex,
      batchSize: opts.batchSize,
    })
    .returning({ id: schema.staticAdGenerations.id });

  try {
    const taskId = await submitNanoBanana({
      prompt: opts.finalPrompt,
      imageUrls: opts.inputUrls,
      aspectRatio: opts.aspectRatio,
      resolution: opts.resolution,
    });
    await db
      .update(schema.staticAdGenerations)
      .set({ status: "generating", kieJobId: taskId, attempts: 1, updatedAt: new Date() })
      .where(eq(schema.staticAdGenerations.id, row.id));
  } catch (e) {
    await db
      .update(schema.staticAdGenerations)
      .set({ status: "error", errorMessage: String((e as Error)?.message ?? e).slice(0, 300), updatedAt: new Date() })
      .where(eq(schema.staticAdGenerations.id, row.id));
  }
  return row.id;
}

/** Create mode: Agent 1 (reference → JSON, once) → Agent 2 per (ratio×variation) → Nano Banana. */
export async function startGeneration(opts: {
  brandId: string;
  referencePath: string;
  productId?: string | null;
  adCopy?: string | null;
  aspectRatios: string[];
  variationCount: number;
  resolution: string;
}): Promise<{ batchId: string; ids: string[] }> {
  const config = await loadConfig(opts.brandId);
  const [brand] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, opts.brandId)).limit(1);
  if (!brand) throw new Error("Brand not found");
  const product = await loadProduct(opts.brandId, opts.productId);

  const ratios = (opts.aspectRatios.length ? opts.aspectRatios : ["1:1"]).slice(0, 4);
  const variations = clamp(opts.variationCount, 1, MAX_VARIATIONS);

  // Agent 1 once (reused across every cell).
  const analysisJson = await analyzeReference(opts.referencePath, config.agent1Prompt, opts.brandId);

  // Agent 2 per cell, composed in parallel (each ends with its own aspect ratio).
  const cells = ratios.flatMap((ratio) => Array.from({ length: variations }, () => ({ ratio })));
  const prompts = await Promise.all(
    cells.map((c) =>
      composePrompt({ analysisJson, agent2Prompt: config.agent2Prompt, aspectRatio: c.ratio, brandId: opts.brandId, product, adCopy: opts.adCopy })
    )
  );

  // Pre-sign Kie inputs once (long expiry — Kie's queue may outlast a 1h URL).
  const refUrl = await signedUrl(opts.referencePath, KIE_INPUT_EXPIRY);
  const productUrl = product?.imagePath ? await signedUrl(product.imagePath, KIE_INPUT_EXPIRY) : null;
  const logoUrl = config.brandLogoPath ? await signedUrl(config.brandLogoPath, KIE_INPUT_EXPIRY) : null;
  const inputUrls = [refUrl, productUrl, logoUrl].filter(Boolean) as string[];

  const batchId = randomUUID();
  const batchSize = cells.length;
  const ids: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    ids.push(
      await submitCell({
        brandId: opts.brandId,
        productId: opts.productId ?? null,
        mode: "custom",
        aspectRatio: cells[i].ratio,
        resolution: opts.resolution,
        finalPrompt: prompts[i],
        analysisJson,
        referencePath: opts.referencePath,
        adCopy: opts.adCopy ?? null,
        batchId,
        batchIndex: i + 1,
        batchSize,
        inputUrls,
      })
    );
  }
  return { batchId, ids };
}

/** Brief mode: Agent 1 reads the brief (+ logo) → Agent 2 per (ratio×variation) → Nano Banana.
 *  An optional product is featured (its image is attached + described). */
export async function startBriefGeneration(opts: {
  brandId: string;
  briefText: string;
  productId?: string | null;
  aspectRatios: string[];
  variationCount: number;
  resolution: string;
}): Promise<{ batchId: string; ids: string[] }> {
  const config = await loadConfig(opts.brandId);
  const product = await loadProduct(opts.brandId, opts.productId);
  const ratios = (opts.aspectRatios.length ? opts.aspectRatios : ["1:1"]).slice(0, 4);
  const variations = clamp(opts.variationCount, 1, MAX_VARIATIONS);

  const a1 = config.briefAgent1Prompt || config.agent1Prompt;
  const a2 = config.briefAgent2Prompt || config.agent2Prompt;

  const analysisJson = await analyzeBrief(opts.briefText, a1, opts.brandId, config.brandLogoPath);

  const cells = ratios.flatMap((ratio) => Array.from({ length: variations }, () => ({ ratio })));
  const prompts = await Promise.all(
    cells.map((c) => composePrompt({ analysisJson, agent2Prompt: a2, aspectRatio: c.ratio, brandId: opts.brandId, product, adCopy: null }))
  );

  const productUrl = product?.imagePath ? await signedUrl(product.imagePath, KIE_INPUT_EXPIRY) : null;
  const logoUrl = config.brandLogoPath ? await signedUrl(config.brandLogoPath, KIE_INPUT_EXPIRY) : null;
  const inputUrls = [productUrl, logoUrl].filter(Boolean) as string[];

  const batchId = randomUUID();
  const batchSize = cells.length;
  const ids: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    ids.push(
      await submitCell({
        brandId: opts.brandId,
        productId: opts.productId ?? null,
        mode: "brief",
        aspectRatio: cells[i].ratio,
        resolution: opts.resolution,
        finalPrompt: prompts[i],
        analysisJson,
        referencePath: null,
        adCopy: null,
        batchId,
        batchIndex: i + 1,
        batchSize,
        inputUrls,
      })
    );
  }
  return { batchId, ids };
}
