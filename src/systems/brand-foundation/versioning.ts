import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { B3 } from "./b3-schema";
import { blankB3 } from "./b3-schema";
import { projectB3ToLegacy } from "./writethrough";

type IntelRow = typeof schema.brandIntelligence.$inferSelect;

async function nextVersion(brandId: string): Promise<number> {
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${schema.brandIntelligence.version}), 0)`.mapWith(Number) })
    .from(schema.brandIntelligence)
    .where(eq(schema.brandIntelligence.brandId, brandId));
  return (max ?? 0) + 1;
}

/** Latest version row, or create a fresh v1 draft seeded from the brand. */
export async function ensureDraft(brandId: string, seed?: { name?: string; category?: string }): Promise<IntelRow> {
  const [latest] = await db
    .select()
    .from(schema.brandIntelligence)
    .where(eq(schema.brandIntelligence.brandId, brandId))
    .orderBy(desc(schema.brandIntelligence.version))
    .limit(1);
  if (latest) return latest;

  const b3 = blankB3(seed);
  b3.meta = { ...b3.meta, version: 1 };
  const [row] = await db
    .insert(schema.brandIntelligence)
    .values({ brandId, version: 1, status: "draft", json: b3, confidenceJson: {}, gapsJson: [], sourceRefsJson: {} })
    .returning();
  return row;
}

/** Create a brand-new draft version (used by re-synthesis / "Edit after approve"). */
export async function createDraft(brandId: string, b3: B3): Promise<IntelRow> {
  const version = await nextVersion(brandId);
  b3.meta = { ...b3.meta, version };
  const [row] = await db
    .insert(schema.brandIntelligence)
    .values({
      brandId,
      version,
      status: "draft",
      json: b3,
      confidenceJson: b3.meta?.confidence_scores ?? {},
      gapsJson: b3.meta?.gaps ?? [],
      sourceRefsJson: b3.meta?.source_refs ?? {},
    })
    .returning();
  return row;
}

/** Save edits into an existing DRAFT version (no-op if that version is approved). */
export async function saveDraftJson(brandId: string, version: number, b3: B3): Promise<IntelRow | null> {
  const [row] = await db
    .update(schema.brandIntelligence)
    .set({
      json: b3,
      confidenceJson: b3.meta?.confidence_scores ?? {},
      gapsJson: b3.meta?.gaps ?? [],
      sourceRefsJson: b3.meta?.source_refs ?? {},
      updatedAt: new Date(),
    })
    .where(and(eq(schema.brandIntelligence.brandId, brandId), eq(schema.brandIntelligence.version, version), eq(schema.brandIntelligence.status, "draft")))
    .returning();
  return row ?? null;
}

/** Approve a version → lock it + write through to the legacy model. */
export async function approveVersion(brandId: string, version: number, approverId: string): Promise<IntelRow> {
  const [row] = await db
    .update(schema.brandIntelligence)
    .set({ status: "approved", approvedBy: approverId, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.brandIntelligence.brandId, brandId), eq(schema.brandIntelligence.version, version)))
    .returning();
  if (!row) throw new Error("Version not found");
  await projectB3ToLegacy(brandId, row.json as B3);
  return row;
}

export async function listVersions(brandId: string): Promise<IntelRow[]> {
  return db
    .select()
    .from(schema.brandIntelligence)
    .where(eq(schema.brandIntelligence.brandId, brandId))
    .orderBy(desc(schema.brandIntelligence.version));
}
