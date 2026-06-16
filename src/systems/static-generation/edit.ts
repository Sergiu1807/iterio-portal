import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { signedUrl } from "@/lib/storage";
import { submitGptImage2, GPT_IMAGE_2_MODEL } from "@/lib/providers/kie";
import { imageBlock } from "./pipeline";
import { SYSTEM_KEY, KIE_INPUT_EXPIRY } from "./constants";

type GenRow = typeof schema.staticAdGenerations.$inferSelect;

async function loadCompleted(brandId: string, generationId: string): Promise<GenRow> {
  const [row] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(and(eq(schema.staticAdGenerations.id, generationId), eq(schema.staticAdGenerations.brandId, brandId)))
    .limit(1);
  if (!row) throw new Error("Generation not found");
  if (row.status !== "completed" || !row.imagePath) throw new Error("Only completed images can be edited");
  return row;
}

export type TextElement = { role: string; text: string };

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "emit_text_elements",
  description: "Return every distinct text element visible on the ad, verbatim.",
  input_schema: {
    type: "object",
    properties: {
      elements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            role: { type: "string", description: "headline | subhead | cta | badge | price | stat | disclaimer | logo | other" },
            text: { type: "string", description: "verbatim text, exact casing & punctuation" },
          },
          required: ["text"],
        },
      },
    },
    required: ["elements"],
  },
};

/** Claude vision → the on-canvas text strings of a completed ad. */
export async function extractText(brandId: string, generationId: string): Promise<TextElement[]> {
  const row = await loadCompleted(brandId, generationId);
  const resp = await callClaude({
    system:
      "You are an OCR + ad-layout analyst. Extract EVERY distinct text element visible on this advertisement, verbatim (exact wording, casing, punctuation). Give each a short role label. Do not invent text that isn't there.",
    messages: [{ role: "user", content: [await imageBlock(row.imagePath!), { type: "text", text: "List every on-canvas text element." }] }],
    maxTokens: 1500,
    tools: [EXTRACT_TOOL],
    toolChoice: { type: "tool", name: "emit_text_elements" },
    systemKey: SYSTEM_KEY,
    brandId,
  });
  const out = toolResult<{ elements: TextElement[] }>(resp, "emit_text_elements");
  return (out?.elements ?? []).filter((e) => e.text?.trim());
}

/** Apply copy edits via gpt-image-2-image-to-image, keeping the composition identical. */
export async function applyEdit(
  brandId: string,
  generationId: string,
  edits: { original: string; replacement: string }[]
): Promise<{ id: string }> {
  const source = await loadCompleted(brandId, generationId);
  const changes = edits.filter((e) => e.replacement?.trim() && e.replacement.trim() !== e.original.trim());
  if (changes.length === 0) throw new Error("No copy changes to apply");

  const lines = changes.map((e) => `- "${e.original}" → "${e.replacement.trim()}"`).join("\n");
  const prompt = `Keep the canvas EXACTLY the same — composition, layout, colors, imagery, fonts, and all positioning must remain identical. The ONLY change: update these on-canvas text strings, matching the original typography, size, color, and alignment as closely as possible:\n${lines}\nDo not add, remove, restyle, or reposition anything else.`;

  const [row] = await db
    .insert(schema.staticAdGenerations)
    .values({
      brandId,
      productId: source.productId,
      mode: "edited",
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
    const inputUrls = [await signedUrl(source.imagePath, KIE_INPUT_EXPIRY)].filter(Boolean) as string[];
    const taskId = await submitGptImage2({ prompt, inputUrls, aspectRatio: source.aspectRatio, resolution: source.resolution });
    await db.update(schema.staticAdGenerations).set({ status: "generating", kieJobId: taskId, attempts: 1, updatedAt: new Date() }).where(eq(schema.staticAdGenerations.id, row.id));
  } catch (e) {
    await db.update(schema.staticAdGenerations).set({ status: "error", errorMessage: String((e as Error)?.message ?? e).slice(0, 300), updatedAt: new Date() }).where(eq(schema.staticAdGenerations.id, row.id));
  }
  return { id: row.id };
}
