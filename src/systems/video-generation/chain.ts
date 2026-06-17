import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchExternalMedia, uploadToStorage, storagePath, extFromContentType } from "@/lib/storage";
import { pollVideoJob } from "@/lib/providers/video-provider";
import { recordKieVideoUsage, SEEDANCE_VIDEO_MODEL } from "@/lib/providers/kie";
import { SYSTEM_KEY, KIND_VIDEOS } from "./constants";

type GenRow = typeof schema.videoGenerations.$inferSelect;

const STUCK_MS = 20 * 60_000; // video is slower than images
const MAX_RESULT_BYTES = 300 * 1024 * 1024;

async function fail(id: string, msg: string): Promise<void> {
  await db
    .update(schema.videoGenerations)
    .set({ status: "error", errorMessage: msg.slice(0, 400), updatedAt: new Date() })
    .where(eq(schema.videoGenerations.id, id));
}

function isStuck(row: GenRow): boolean {
  return Date.now() - new Date(row.updatedAt).getTime() > STUCK_MS;
}

/** Advance one 'generating' row: poll Kie → fetch the mp4 → store → complete. */
export async function advanceVideoGeneration(row: GenRow, slug: string): Promise<void> {
  if (row.status !== "generating" || !row.kieJobId) return;

  let poll;
  try {
    poll = await pollVideoJob(row.kieJobId);
  } catch {
    if (isStuck(row)) await fail(row.id, "Polling timed out");
    return;
  }

  if (poll.state === "failed") {
    await fail(row.id, poll.errorMessage ?? "Video generation failed");
    return;
  }
  if (poll.state !== "success" || !poll.videoUrl) {
    if (isStuck(row)) await fail(row.id, "Generation timed out");
    return;
  }

  const media = await fetchExternalMedia(poll.videoUrl, { maxBytes: MAX_RESULT_BYTES, timeoutMs: 60_000 });
  if (!media) {
    if (isStuck(row)) await fail(row.id, "Could not fetch generated video");
    return;
  }

  const ext = extFromContentType(media.contentType); // mp4 supported
  const path = storagePath(slug, KIND_VIDEOS, `${row.id}.${ext}`);
  await uploadToStorage(path, media.buffer, media.contentType);

  const done = await db
    .update(schema.videoGenerations)
    .set({ status: "completed", videoPath: path, outputFormat: ext, updatedAt: new Date() })
    .where(and(eq(schema.videoGenerations.id, row.id), eq(schema.videoGenerations.status, "generating")))
    .returning({ id: schema.videoGenerations.id });

  if (done.length) {
    await recordKieVideoUsage({
      model: row.kieModel ?? SEEDANCE_VIDEO_MODEL,
      duration: row.duration,
      systemKey: SYSTEM_KEY,
      brandId: row.brandId,
      meta: { generationId: row.id, videoType: row.videoType },
    });
  }
}

/** Advance all 'generating' rows for one brand (UI tick). */
export async function advanceBrandVideoGenerations(brandId: string, limit = 6): Promise<number> {
  const rows = await db
    .select()
    .from(schema.videoGenerations)
    .where(and(eq(schema.videoGenerations.brandId, brandId), eq(schema.videoGenerations.status, "generating")))
    .orderBy(asc(schema.videoGenerations.createdAt))
    .limit(limit);
  if (!rows.length) return 0;

  const [brand] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  const slug = brand?.slug ?? brandId;
  for (const r of rows) {
    try {
      await advanceVideoGeneration(r, slug);
    } catch (e) {
      console.warn("[video-chain] advance failed", r.id, e);
    }
  }
  return rows.length;
}

/** Advance 'generating' rows across all brands (cron backstop). */
export async function advanceAllVideoGenerations(limit = 15): Promise<number> {
  const rows = await db
    .select()
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.status, "generating"))
    .orderBy(asc(schema.videoGenerations.createdAt))
    .limit(limit);
  if (!rows.length) return 0;

  const slugByBrand = new Map<string, string>();
  for (const brandId of new Set(rows.map((r) => r.brandId))) {
    const [b] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
    slugByBrand.set(brandId, b?.slug ?? brandId);
  }
  for (const r of rows) {
    try {
      await advanceVideoGeneration(r, slugByBrand.get(r.brandId)!);
    } catch (e) {
      console.warn("[video-chain] advance failed", r.id, e);
    }
  }
  return rows.length;
}
