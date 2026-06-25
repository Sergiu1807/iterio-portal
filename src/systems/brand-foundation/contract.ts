import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { B3 } from "./b3-schema";

/**
 * THE STABLE GROUNDING CONTRACT.
 * Returns the latest APPROVED Brand Intelligence (B3) for a brand, or null if the
 * brand hasn't completed onboarding yet. New downstream code should read brand
 * grounding through this — existing systems keep reading the legacy projection
 * (intelligence_sections/products/personas/usps) which `approveVersion` writes through.
 */
export async function getApprovedBrandIntelligence(brandId: string): Promise<B3 | null> {
  const [row] = await db
    .select({ json: schema.brandIntelligence.json })
    .from(schema.brandIntelligence)
    .where(and(eq(schema.brandIntelligence.brandId, brandId), eq(schema.brandIntelligence.status, "approved")))
    .orderBy(desc(schema.brandIntelligence.version))
    .limit(1);
  return (row?.json as B3 | undefined) ?? null;
}

/** Approved B3 + its version number (for systems that surface "grounding on vN"). */
export async function getApprovedBrandIntelligenceMeta(brandId: string): Promise<{ b3: B3; version: number } | null> {
  const [row] = await db
    .select({ json: schema.brandIntelligence.json, version: schema.brandIntelligence.version })
    .from(schema.brandIntelligence)
    .where(and(eq(schema.brandIntelligence.brandId, brandId), eq(schema.brandIntelligence.status, "approved")))
    .orderBy(desc(schema.brandIntelligence.version))
    .limit(1);
  if (!row?.json) return null;
  return { b3: row.json as B3, version: row.version };
}

/** Latest version row (draft or approved) — used by the onboarding workspace. */
export async function getLatestBrandIntelligence(brandId: string) {
  const [row] = await db
    .select()
    .from(schema.brandIntelligence)
    .where(eq(schema.brandIntelligence.brandId, brandId))
    .orderBy(desc(schema.brandIntelligence.version))
    .limit(1);
  return row ?? null;
}
