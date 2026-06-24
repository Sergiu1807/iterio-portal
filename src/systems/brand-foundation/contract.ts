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
