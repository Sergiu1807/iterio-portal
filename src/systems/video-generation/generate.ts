import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { signedUrl } from "@/lib/storage";
import { submitVideoJob, videoModelId } from "@/lib/providers/video-provider";
import { buildBrandGrounding, compactBrandContext } from "@/lib/brand-grounding";
import { KIE_INPUT_EXPIRY, MAX_VARIATIONS } from "./constants";
import {
  craftPromptAgent,
  generateStudioFlowPrompt,
  cleanPrompt,
  cleanVoiceDialogue,
  formatProductOnlyTemplate,
  formatDualRefTemplate,
  formatNoRefTemplate,
  formatBrollTemplate,
  formatArollStreetWithProductTemplate,
  formatArollStreetNoProductTemplate,
  formatArollTalkingHeadTemplate,
  formatArollPodcastWithRefsTemplate,
  formatArollPodcastNoRefsTemplate,
  formatArollGreenScreenTemplate,
} from "./pipeline";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n | 0));

export type VideoGenOpts = {
  brandId: string;
  videoType: "ugc" | "broll" | "aroll";
  arollStyle?: string | null;
  productId?: string | null;
  characterIds?: string[];
  sceneId?: string | null;
  script?: string | null;
  duration: number;
  aspectRatio: string;
  resolution: string;
  variationCount: number;
};

function computeMode(videoType: string, arollStyle: string | null | undefined, hasProduct: boolean, hasCharacter: boolean): string {
  if (videoType === "aroll") return arollStyle || "talking-head";
  if (videoType === "broll") return "broll";
  if (videoType === "ugc" && !hasProduct && !hasCharacter) return "no_ref";
  return hasCharacter ? "product_character" : "product_only";
}

/** Insert the pending batch rows (sync). The pipeline + submit runs in runVideoBatch (after()). */
export async function startVideoBatch(opts: VideoGenOpts): Promise<{ batchId: string; ids: string[] }> {
  const variations = clamp(opts.variationCount, 1, MAX_VARIATIONS);
  const productId = opts.productId ?? null;
  const primaryCharacterId = opts.characterIds?.[0] ?? null;
  const mode = computeMode(opts.videoType, opts.arollStyle, !!productId, (opts.characterIds?.length ?? 0) > 0);
  const batchId = randomUUID();

  const ids: string[] = [];
  for (let i = 0; i < variations; i++) {
    const [row] = await db
      .insert(schema.videoGenerations)
      .values({
        brandId: opts.brandId,
        productId,
        characterId: primaryCharacterId,
        sceneId: opts.sceneId ?? null,
        videoType: opts.videoType,
        arollStyle: opts.arollStyle ?? null,
        mode,
        status: "pending",
        kieModel: videoModelId(),
        duration: opts.duration,
        aspectRatio: opts.aspectRatio,
        resolution: opts.resolution,
        script: opts.script ?? null,
        batchId,
        batchIndex: i + 1,
        batchSize: variations,
      })
      .returning({ id: schema.videoGenerations.id });
    ids.push(row.id);
  }
  return { batchId, ids };
}

async function failBatch(batchId: string, msg: string) {
  await db
    .update(schema.videoGenerations)
    .set({ status: "error", errorMessage: msg.slice(0, 400), updatedAt: new Date() })
    .where(and(eq(schema.videoGenerations.batchId, batchId), eq(schema.videoGenerations.status, "pending")));
}

/** Run the universal prompt pipeline once, then submit one Seedance job per row. */
export async function runVideoBatch(batchId: string, opts: VideoGenOpts): Promise<void> {
  try {
    const [brand] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, opts.brandId)).limit(1);
    if (!brand) throw new Error("brand not found");

    let product: { name: string; imagePath: string | null } | null = null;
    if (opts.productId) {
      const [p] = await db.select().from(schema.products).where(and(eq(schema.products.id, opts.productId), eq(schema.products.brandId, opts.brandId))).limit(1);
      if (p) product = { name: p.name, imagePath: p.videoImageUrl ?? p.imageUrl ?? null };
    }

    const characters = opts.characterIds?.length
      ? await db.select().from(schema.videoCharacters).where(and(inArray(schema.videoCharacters.id, opts.characterIds), eq(schema.videoCharacters.brandId, opts.brandId)))
      : [];

    let scene: { imagePath: string } | null = null;
    if (opts.sceneId) {
      const [s] = await db.select().from(schema.videoScenes).where(and(eq(schema.videoScenes.id, opts.sceneId), eq(schema.videoScenes.brandId, opts.brandId))).limit(1);
      if (s) scene = { imagePath: s.imagePath };
    }

    const hasProduct = !!product;
    const hasCharacter = characters.length > 0;
    const isAroll = opts.videoType === "aroll";
    const isNoRefUGC = opts.videoType === "ugc" && !hasProduct && !hasCharacter;
    // Recompute mode from what actually loaded (product may be missing/not owned),
    // so the stored label matches the template the pipeline really used.
    const mode = computeMode(opts.videoType, opts.arollStyle, hasProduct, hasCharacter);

    // Brand grounding (B3-first, flat-fallback) → a compact voice/compliance block.
    const brandContext = compactBrandContext(await buildBrandGrounding(opts.brandId));

    // ── universal prompt pipeline (Claude) ──
    const crafter = await craftPromptAgent({
      productName: product?.name ?? "",
      hasCharacter,
      script: opts.script ?? "",
      videoType: opts.videoType,
      arollStyle: opts.arollStyle ?? undefined,
      hasProduct,
      characterNames: characters.map((c) => c.name),
      characterDescriptions: characters.map((c) => ({ name: c.name, description: c.description ?? "" })),
      brandContext,
    });
    const studioFlow = await generateStudioFlowPrompt(crafter);
    const cleaned = await cleanPrompt(studioFlow);

    const ar = opts.aspectRatio;
    const dur = opts.duration;
    let finalPrompt: string;
    if (isAroll && opts.arollStyle === "street-interview") {
      finalPrompt = hasProduct
        ? await formatArollStreetWithProductTemplate(cleaned, ar, dur)
        : await formatArollStreetNoProductTemplate(cleaned, ar, dur);
    } else if (isAroll && opts.arollStyle === "talking-head") {
      finalPrompt = await formatArollTalkingHeadTemplate(cleaned, ar, dur);
    } else if (isAroll && opts.arollStyle === "podcast") {
      finalPrompt = hasCharacter || !!scene ? await formatArollPodcastWithRefsTemplate(cleaned, ar, dur) : await formatArollPodcastNoRefsTemplate(cleaned, ar, dur);
    } else if (isAroll && opts.arollStyle === "green-screen") {
      finalPrompt = await formatArollGreenScreenTemplate(cleaned, ar, dur);
    } else if (opts.videoType === "broll") {
      finalPrompt = await formatBrollTemplate(cleaned, ar, dur);
    } else if (isNoRefUGC) {
      finalPrompt = await formatNoRefTemplate(cleaned, ar, dur);
    } else if (hasCharacter) {
      finalPrompt = await formatDualRefTemplate(cleaned, ar, dur);
    } else {
      finalPrompt = await formatProductOnlyTemplate(cleaned, ar, dur);
    }

    const promptForSeedance = isAroll || isNoRefUGC ? await cleanVoiceDialogue(finalPrompt) : finalPrompt;

    // ── reference images (signed long-expiry for Kie) ──
    const inputUrls = (
      await Promise.all([
        product?.imagePath ? signedUrl(product.imagePath, KIE_INPUT_EXPIRY) : null,
        scene?.imagePath ? signedUrl(scene.imagePath, KIE_INPUT_EXPIRY) : null,
        ...characters.map((c) => signedUrl(c.imagePath, KIE_INPUT_EXPIRY)),
      ])
    ).filter(Boolean) as string[];

    // ── submit one Seedance job per row (idempotent: claim pending→submitting
    //    with a guarded UPDATE so a retried after() can never double-charge) ──
    const rows = await db
      .select({ id: schema.videoGenerations.id })
      .from(schema.videoGenerations)
      .where(and(eq(schema.videoGenerations.batchId, batchId), eq(schema.videoGenerations.status, "pending")));
    for (const row of rows) {
      // Claim the row: only one runner can flip pending→submitting.
      const claimed = await db
        .update(schema.videoGenerations)
        .set({ status: "submitting", mode, crafterPrompt: crafter, studioFlowPrompt: studioFlow, finalPrompt: promptForSeedance, updatedAt: new Date() })
        .where(and(eq(schema.videoGenerations.id, row.id), eq(schema.videoGenerations.status, "pending")))
        .returning({ id: schema.videoGenerations.id });
      if (!claimed.length) continue; // already claimed by another invocation
      try {
        const taskId = await submitVideoJob({ prompt: promptForSeedance, imageUrls: inputUrls, aspectRatio: ar, duration: dur, resolution: opts.resolution });
        await db
          .update(schema.videoGenerations)
          .set({ status: "generating", kieJobId: taskId, attempts: 1, updatedAt: new Date() })
          .where(eq(schema.videoGenerations.id, row.id));
      } catch (e) {
        await db
          .update(schema.videoGenerations)
          .set({ status: "error", errorMessage: String((e as Error)?.message ?? e).slice(0, 400), updatedAt: new Date() })
          .where(eq(schema.videoGenerations.id, row.id));
      }
    }
  } catch (e) {
    console.warn("[video] pipeline failed", batchId, e);
    await failBatch(batchId, `Pipeline failed: ${String((e as Error)?.message ?? e)}`);
  }
}
