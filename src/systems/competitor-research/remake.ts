import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { callGemini } from "@/lib/providers/gemini";
import { downloadFromStorage, signedUrl } from "@/lib/storage";

const SYSTEM_KEY = "competitor-research";
const MAX_INLINE_VIDEO = 14 * 1024 * 1024;

type AdRow = typeof schema.competitorAds.$inferSelect;
type AngleBankRow = typeof schema.angleBankEntries.$inferSelect;
type Product = { name: string; keyBenefits: string | null };
type Compliance = { pass: boolean; failures: string[] };

async function brandIntel(brandId: string): Promise<{ name: string; category: string | null; voice: string }> {
  const [b] = await db
    .select({ name: schema.brands.name, category: schema.brands.category, vibe: schema.brands.vibe })
    .from(schema.brands)
    .where(eq(schema.brands.id, brandId))
    .limit(1);
  const sections = await db
    .select({ title: schema.intelligenceSections.title, content: schema.intelligenceSections.content })
    .from(schema.intelligenceSections)
    .where(eq(schema.intelligenceSections.brandId, brandId))
    .orderBy(asc(schema.intelligenceSections.sortOrder))
    .limit(4);
  const voice = [b?.vibe ? `Vibe: ${b.vibe}` : "", ...sections.map((s) => `${s.title}: ${(s.content ?? "").slice(0, 500)}`)].filter(Boolean).join("\n");
  return { name: b?.name ?? "our brand", category: b?.category ?? null, voice };
}

/** Auto-pick the product to feature: the hero, else the first, else none. */
async function heroProductId(brandId: string): Promise<string | null> {
  const rows = await db.select({ id: schema.products.id, isHero: schema.products.isHero }).from(schema.products).where(eq(schema.products.brandId, brandId));
  if (!rows.length) return null;
  return (rows.find((r) => r.isHero) ?? rows[0]).id;
}

async function loadProduct(brandId: string, productId?: string | null): Promise<Product | null> {
  if (!productId) return null;
  const [p] = await db
    .select({ name: schema.products.name, keyBenefits: schema.products.keyBenefits })
    .from(schema.products)
    .where(and(eq(schema.products.id, productId), eq(schema.products.brandId, brandId)))
    .limit(1);
  return p ?? null;
}

async function markApproved(angleBankId: string): Promise<void> {
  await db.update(schema.angleBankEntries).set({ status: "approved", updatedAt: new Date() }).where(eq(schema.angleBankEntries.id, angleBankId));
}

// ── adapt the winner copy to our brand (Static) ─────────────────────────────
const COPY_TOOL: Anthropic.Tool = {
  name: "emit_adapted_copy",
  description: "Return the winning ad's copy re-expressed for OUR brand.",
  input_schema: {
    type: "object",
    properties: { headline: { type: "string" }, primary_text: { type: "string" } },
    required: ["headline", "primary_text"],
  },
};

async function adaptCopy(brandId: string, ad: AdRow, bank: AngleBankRow, product: Product | null): Promise<string> {
  const intel = await brandIntel(brandId);
  const resp = await callClaude({
    model: "claude-sonnet-4-6",
    maxTokens: 700,
    system:
      "You adapt a winning competitor ad's copy to OUR brand. Re-express the SAME angle/mechanism on our product in our voice. Never mention the competitor, never copy their exact wording, never make a claim our category can't legally support.",
    messages: [
      {
        role: "user",
        content: [
          `Our brand: ${intel.name}${intel.category ? ` (${intel.category})` : ""}`,
          `Our voice/positioning:\n${intel.voice || "(none on file)"}`,
          product ? `Feature our product: ${product.name}${product.keyBenefits ? ` — ${product.keyBenefits}` : ""}` : "Feature the brand generally (no specific product).",
          "\n--- Winning competitor ad to adapt ---",
          `Angle: ${bank.angle ?? ad.creativeAngle ?? "?"}`,
          `Mechanism: ${bank.mechanism ?? ad.proofMechanism ?? "?"}`,
          `Hook: ${bank.hook ?? ad.visualHook ?? "?"}`,
          `Their headline: ${ad.headlineTitle ?? "(none)"}`,
          `Their primary text: ${ad.displayPrimaryText ?? "(none)"}`,
          bank.complianceFlags?.length ? `Avoid these compliance issues from the source: ${bank.complianceFlags.join("; ")}` : "",
          "\nReturn our adapted headline + primary_text via emit_adapted_copy.",
        ].join("\n"),
      },
    ],
    tools: [COPY_TOOL],
    toolChoice: { type: "tool", name: "emit_adapted_copy" },
    systemKey: SYSTEM_KEY,
    brandId,
  });
  const a = toolResult<{ headline: string; primary_text: string }>(resp, "emit_adapted_copy");
  if (!a) throw new Error("Copy adaptation failed");
  return `${a.headline}\n\n${a.primary_text}`.trim();
}

// ── deep video analysis + brief (Video) ─────────────────────────────────────
function videoMime(path: string): string {
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".mov")) return "video/quicktime";
  return "video/mp4";
}

/** A fresh, exhaustive 1:1 timeline read of the competitor video (the stored
 *  geminiDescription is capped); falls back to stored analysis if unavailable. */
async function deepVideoAnalysis(brandId: string, ad: AdRow): Promise<string> {
  if (ad.videoPath) {
    try {
      const buf = await downloadFromStorage(ad.videoPath);
      if (buf.length <= MAX_INLINE_VIDEO) {
        return await callGemini({
          prompt:
            "Give a precise, timestamped 1:1 breakdown of this video ad. For each beat / second-range: the on-screen action, any on-screen text, and the spoken words (verbatim). Then describe the pacing/editing rhythm and the closing CTA. Be concrete and exhaustive.",
          media: { base64: buf.toString("base64"), mimeType: videoMime(ad.videoPath) },
          maxOutputTokens: 2200,
          systemKey: SYSTEM_KEY,
          brandId,
        });
      }
    } catch {
      /* fall through to stored */
    }
  }
  return [ad.geminiDescription, ad.fullTranscript].filter(Boolean).join("\n\n") || "(no video analysis available)";
}

const VIDEO_BRIEF_TOOL: Anthropic.Tool = {
  name: "emit_video_brief",
  description: "Return the adapted Script/direction brief for our video generator.",
  input_schema: { type: "object", properties: { brief: { type: "string" } }, required: ["brief"] },
};

async function composeVideoBrief(brandId: string, deep: string, ad: AdRow, bank: AngleBankRow, product: Product | null, duration: number): Promise<string> {
  const intel = await brandIntel(brandId);
  const resp = await callClaude({
    model: "claude-sonnet-4-6",
    maxTokens: 1200,
    system:
      `You turn a winning competitor video into a Script/direction brief for OUR brand's video generator. Re-tell the SAME concept and structure on our product, in our voice — never reference or clone the competitor. Keep it filmable and tight for a ~${duration}s runtime (the generator caps spoken words, so keep dialogue lean).`,
    messages: [
      {
        role: "user",
        content: [
          `Our brand: ${intel.name}${intel.category ? ` (${intel.category})` : ""}`,
          `Our voice:\n${intel.voice || "(none on file)"}`,
          product ? `Our product: ${product.name}${product.keyBenefits ? ` — ${product.keyBenefits}` : ""}` : "No specific product — keep it brand-level.",
          "\n--- Winning competitor video: deep 1:1 analysis (visual timeline + transcript) ---",
          deep.slice(0, 4000),
          "\n--- Marketing teardown ---",
          `Angle: ${bank.angle ?? ad.creativeAngle ?? "?"} · Mechanism: ${bank.mechanism ?? ad.proofMechanism ?? "?"} · Hook: ${bank.hook ?? ad.visualHook ?? "?"} · Driver: ${bank.emotionalDriver ?? ""}`,
          bank.beatStructure?.length ? `Beats: ${bank.beatStructure.map((b) => `${b.beat}: ${b.text}`).join(" | ")}` : "",
          bank.complianceFlags?.length ? `Avoid these compliance issues from the source: ${bank.complianceFlags.join("; ")}` : "",
          "\nWrite the adapted Script/direction brief (scene direction + tight spoken lines) via emit_video_brief.",
        ].join("\n"),
      },
    ],
    tools: [VIDEO_BRIEF_TOOL],
    toolChoice: { type: "tool", name: "emit_video_brief" },
    systemKey: SYSTEM_KEY,
    brandId,
  });
  const a = toolResult<{ brief: string }>(resp, "emit_video_brief");
  if (!a) throw new Error("Video brief composition failed");
  return a.brief.trim();
}

// ── adversarial compliance gate (advisory in the hand-off flow) ─────────────
const GATE_TOOL: Anthropic.Tool = {
  name: "emit_verdict",
  description: "Return the compliance verdict.",
  input_schema: {
    type: "object",
    properties: {
      pass: { type: "boolean" },
      failures: { type: "array", items: { type: "string" }, description: "Each failed check + why; empty if it passes." },
    },
    required: ["pass", "failures"],
  },
};

async function complianceGate(brandId: string, kind: string, content: string, sourceFlags: string[]): Promise<Compliance> {
  const intel = await brandIntel(brandId);
  const resp = await callClaude({
    model: "claude-sonnet-4-6",
    maxTokens: 600,
    system:
      `You are a strict compliance + brand reviewer. Judge the candidate ${kind} against ALL six checks and default to FAIL if uncertain: (1) on-brand for our voice, (2) doesn't read as obviously AI/generic, (3) claim-safe for our category — no prohibited or unsupported claims (be especially strict for health/supplements), (4) the hook lands in the first 1-2 seconds, (5) a single clear CTA, (6) angle integrity (built on a real mechanism, not just pretty). List every failed check with a reason.`,
    messages: [
      {
        role: "user",
        content: [
          `Our brand: ${intel.name}${intel.category ? ` (${intel.category})` : ""}`,
          sourceFlags.length ? `Risky claims flagged in the SOURCE angle (must not carry over): ${sourceFlags.join("; ")}` : "",
          `\nCandidate ${kind}:\n${content}`,
          "\nReturn the verdict via emit_verdict.",
        ].join("\n"),
      },
    ],
    tools: [GATE_TOOL],
    toolChoice: { type: "tool", name: "emit_verdict" },
    systemKey: SYSTEM_KEY,
    brandId,
  });
  const v = toolResult<Compliance>(resp, "emit_verdict");
  if (!v) return { pass: false, failures: ["Compliance check could not be completed."] };
  return { pass: !!v.pass, failures: Array.isArray(v.failures) ? v.failures : [] };
}

// ── prepare a prefill for the EXISTING Static/Video Create form ──────────────
export type StaticPrefill = {
  target: "static";
  brandId: string;
  conceptId: string;
  referencePath: string;
  referenceUrl: string | null;
  adCopy: string;
  productId: string | null;
  aspectRatios: string[];
  variationCount: number;
  resolution: string;
  compliance: Compliance;
};
export type VideoPrefill = {
  target: "video";
  brandId: string;
  conceptId: string;
  script: string;
  productId: string | null;
  videoType: "ugc";
  duration: number;
  aspectRatio: string;
  resolution: string;
  variationCount: number;
  compliance: Compliance;
};

/** Static: competitor image as the reference + adapted winner copy → prefill the Reference-mode Create form. */
export async function prepareStaticRemake(brandId: string, conceptId: string, ad: AdRow, bank: AngleBankRow): Promise<StaticPrefill> {
  if (!ad.primaryThumbnail) throw new Error("This winner has no stored image to use as a reference.");
  const productId = await heroProductId(brandId);
  const product = await loadProduct(brandId, productId);
  const adCopy = await adaptCopy(brandId, ad, bank, product);
  const compliance = await complianceGate(brandId, "static ad copy", adCopy, bank.complianceFlags ?? []);
  await markApproved(bank.id);
  return {
    target: "static",
    brandId,
    conceptId,
    referencePath: ad.primaryThumbnail, // already in our bucket; the Create form analyzes it as the reference
    referenceUrl: await signedUrl(ad.primaryThumbnail),
    adCopy,
    productId,
    aspectRatios: ["1:1", "4:5"],
    variationCount: 2,
    resolution: "2K",
    compliance,
  };
}

/** Video: deep 1:1 analysis + teardown → adapted Script/direction brief → prefill the Video Create form. */
export async function prepareVideoRemake(brandId: string, conceptId: string, ad: AdRow, bank: AngleBankRow): Promise<VideoPrefill> {
  const productId = await heroProductId(brandId);
  const product = await loadProduct(brandId, productId);
  const duration = 10;
  const deep = await deepVideoAnalysis(brandId, ad);
  const script = await composeVideoBrief(brandId, deep, ad, bank, product, duration);
  const compliance = await complianceGate(brandId, "video script", script, bank.complianceFlags ?? []);
  await markApproved(bank.id);
  return { target: "video", brandId, conceptId, script, productId, videoType: "ugc", duration, aspectRatio: "9:16", resolution: "720p", variationCount: 1, compliance };
}
