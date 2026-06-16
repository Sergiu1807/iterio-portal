import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchExternalMedia, uploadToStorage, storagePath, extFromContentType } from "@/lib/storage";
import { pollKieJob, recordKieImageUsage, NANO_BANANA_MODEL } from "@/lib/providers/kie";
import { SYSTEM_KEY, KIND_ADS } from "./constants";

type GenRow = typeof schema.staticAdGenerations.$inferSelect;

const STUCK_MS = 15 * 60_000;
const MAX_RESULT_BYTES = 25 * 1024 * 1024;

async function fail(id: string, msg: string): Promise<void> {
  await db
    .update(schema.staticAdGenerations)
    .set({ status: "error", errorMessage: msg.slice(0, 300), updatedAt: new Date() })
    .where(eq(schema.staticAdGenerations.id, id));
}

function isStuck(row: GenRow): boolean {
  return Date.now() - new Date(row.updatedAt).getTime() > STUCK_MS;
}

/** Advance one 'generating' row: poll Kie → persist result to storage → complete. */
export async function advanceGeneration(row: GenRow, slug: string): Promise<void> {
  if (row.status !== "generating" || !row.kieJobId) return;

  let poll;
  try {
    poll = await pollKieJob(row.kieJobId);
  } catch {
    if (isStuck(row)) await fail(row.id, "Polling timed out");
    return;
  }

  if (poll.state === "failed") {
    await fail(row.id, poll.errorMessage ?? "Image generation failed");
    return;
  }
  if (poll.state !== "success" || !poll.resultUrls[0]) {
    if (isStuck(row)) await fail(row.id, "Generation timed out");
    return;
  }

  const media = await fetchExternalMedia(poll.resultUrls[0], { maxBytes: MAX_RESULT_BYTES, timeoutMs: 30_000 });
  if (!media) {
    if (isStuck(row)) await fail(row.id, "Could not fetch generated image");
    return;
  }

  const ext = extFromContentType(media.contentType);
  const path = storagePath(slug, KIND_ADS, `${row.id}.${ext}`);
  await uploadToStorage(path, media.buffer, media.contentType);

  // Guarded finalize — only the writer that flips 'generating'→'completed' records usage.
  const done = await db
    .update(schema.staticAdGenerations)
    .set({ status: "completed", imagePath: path, outputFormat: ext, updatedAt: new Date() })
    .where(and(eq(schema.staticAdGenerations.id, row.id), eq(schema.staticAdGenerations.status, "generating")))
    .returning({ id: schema.staticAdGenerations.id });

  if (done.length) {
    await recordKieImageUsage({
      model: row.kieModel ?? NANO_BANANA_MODEL,
      resolution: row.resolution,
      systemKey: SYSTEM_KEY,
      brandId: row.brandId,
      meta: { generationId: row.id, mode: row.mode },
    });
  }
}

/** Advance all 'generating' rows for one brand (UI tick). */
export async function advanceBrandGenerations(brandId: string, limit = 8): Promise<number> {
  const rows = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(and(eq(schema.staticAdGenerations.brandId, brandId), eq(schema.staticAdGenerations.status, "generating")))
    .orderBy(asc(schema.staticAdGenerations.createdAt))
    .limit(limit);
  if (!rows.length) return 0;

  const [brand] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  const slug = brand?.slug ?? brandId;
  for (const r of rows) {
    try {
      await advanceGeneration(r, slug);
    } catch (e) {
      console.warn("[static-chain] advance failed", r.id, e);
    }
  }
  return rows.length;
}

/** Advance 'generating' rows across all brands (cron backstop). */
export async function advanceAllGenerations(limit = 20): Promise<number> {
  const rows = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.status, "generating"))
    .orderBy(asc(schema.staticAdGenerations.createdAt))
    .limit(limit);
  if (!rows.length) return 0;

  const slugByBrand = new Map<string, string>();
  for (const brandId of new Set(rows.map((r) => r.brandId))) {
    const [b] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
    slugByBrand.set(brandId, b?.slug ?? brandId);
  }
  for (const r of rows) {
    try {
      await advanceGeneration(r, slugByBrand.get(r.brandId)!);
    } catch (e) {
      console.warn("[static-chain] advance failed", r.id, e);
    }
  }
  return rows.length;
}
