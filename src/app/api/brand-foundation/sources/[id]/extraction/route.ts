import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Raw artifact + structured extraction for one source (the Raw | Structured tabs). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const [source] = await db.select().from(schema.brandSources).where(eq(schema.brandSources.id, id)).limit(1);
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const [extraction] = await db.select().from(schema.extractions).where(eq(schema.extractions.sourceId, id)).limit(1);
  const [raw] = await db
    .select({ kind: schema.rawArtifacts.kind, meta: schema.rawArtifacts.meta })
    .from(schema.rawArtifacts)
    .where(eq(schema.rawArtifacts.jobId, (extraction?.jobId ?? "00000000-0000-0000-0000-000000000000")))
    .orderBy(desc(schema.rawArtifacts.createdAt))
    .limit(1);

  return NextResponse.json({
    type: source.type,
    structured: extraction ? { schemaType: extraction.schemaType, json: extraction.json, confidence: extraction.confidence } : null,
    raw: raw?.meta ?? (["meta_ads", "competitor"].includes(source.type) ? { note: "Scraped via Competitor Research — see the Winner Board for ads, clusters and the angle bank.", scrapeJobId: source.config?.scrapeJobId } : null),
  });
}
