import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaude, toolResult } from "@/lib/providers/claude";
import { callGemini } from "@/lib/providers/gemini";
import { tavilySearch } from "@/lib/providers/tavily";
import { crawlBrandSite, fetchExternalMedia, extFromContentType } from "@/lib/storage";

const SYSTEM_KEY = "brand-onboarding";

type SourceRow = typeof schema.brandSources.$inferSelect;
type JobRow = typeof schema.researchJobs.$inferSelect;

type CatalogProduct = { name: string; price?: string; format?: string; desc?: string; images?: string[] };

/** Shopify /products.json → structured catalog (reliable; doesn't depend on the LLM). */
async function shopifyCatalog(origin: string): Promise<{ summary: string; products: CatalogProduct[] }> {
  try {
    const res = await fetch(`${origin}/products.json?limit=250`, { signal: AbortSignal.timeout(12_000), headers: { "user-agent": "Mozilla/5.0 (compatible; IterioBot/1.0)" } });
    if (!res.ok) return { summary: "", products: [] };
    const data = (await res.json()) as { products?: { title?: string; product_type?: string; body_html?: string; variants?: { price?: string }[]; images?: { src?: string }[] }[] };
    const raw = Array.isArray(data?.products) ? data.products : [];
    const products: CatalogProduct[] = raw.slice(0, 50).map((p) => ({
      name: String(p.title ?? "Product"),
      price: p.variants?.[0]?.price,
      format: p.product_type || undefined,
      desc: String(p.body_html ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 400) || undefined,
      images: (p.images ?? []).map((i) => String(i.src ?? "")).filter((s) => /^https?:\/\//.test(s)),
    }));
    const summary = products.map((p) => `- ${p.name}${p.price ? ` ($${p.price})` : ""}${p.format ? ` [${p.format}]` : ""}${p.desc ? `: ${p.desc}` : ""}`).join("\n");
    return { summary, products };
  } catch {
    return { summary: "", products: [] };
  }
}

// On Shopify, ingredient/dosage copy almost never lives in body_html — it's baked into
// a "Supplement Facts" / label image on the PDP. These are the filename fragments that
// flag an image as the label/facts panel so we send those to vision first.
const LABEL_HINT = /(label|ingredient|facts|nutrition|supplement|panel|directions|back|spec)/i;
const MAX_VISION_PRODUCTS = 8; // upper cap; the 22s wall-clock budget is the real governor
const MAX_VISION_IMAGES = 2; // images per product sent to Gemini

function pickLabelImages(images: string[]): string[] {
  if (!images.length) return [];
  const hinted = images.filter((u) => LABEL_HINT.test(u));
  // hinted (likely label) first, then the rest in order (2nd image is often the label)
  const ordered = [...hinted, ...images.filter((u) => !hinted.includes(u))];
  return Array.from(new Set(ordered)).slice(0, MAX_VISION_IMAGES);
}

// Shopify often serves a .webp/.png URL as image/jpeg etc. — normalise to a mime Gemini
// accepts (never "image/jpg", which is non-standard and can be rejected).
function normMime(contentType: string): string {
  const e = extFromContentType(contentType);
  return e === "jpg" ? "image/jpeg" : `image/${e}`;
}

/** Gemini reads a product's Supplement Facts / ingredient panel from its PDP images. */
async function ingredientsFromImages(
  brandId: string,
  name: string,
  images: string[]
): Promise<{ ingredients: string[]; dosage?: string } | null> {
  const picks = pickLabelImages(images);
  if (!picks.length) return null;
  const fetched = await Promise.all(picks.map((url) => fetchExternalMedia(url, { maxBytes: 6 * 1024 * 1024, timeoutMs: 12_000 })));
  const media = fetched
    .filter((m): m is NonNullable<typeof m> => !!m && m.contentType.startsWith("image/"))
    .map((m) => ({ base64: m.buffer.toString("base64"), mimeType: normMime(m.contentType) }));
  if (!media.length) return null;

  const prompt =
    `These are product images for "${name}". Read any Supplement Facts / Nutrition / ingredient panel or directions visible in the images.\n` +
    `Return ONLY JSON: {"ingredients": ["Ingredient amount", ...], "dosage": "serving size / directions"}.\n` +
    `- ingredients = each active/named ingredient WITH its amount if shown (e.g. "Ashwagandha root extract 300mg"). Skip generic "other ingredients" filler unless that's all there is.\n` +
    `- dosage = the serving size / usage directions (e.g. "Mix 1 scoop in water daily").\n` +
    `If NO facts/ingredient panel is visible in these images, return {"ingredients": [], "dosage": ""}. Do not guess or invent.`;

  let text = "";
  try {
    text = await callGemini({ prompt, media, maxOutputTokens: 900, systemKey: SYSTEM_KEY, brandId });
  } catch (e) {
    console.warn("[website] ingredient-vision failed for", name, String(e).slice(0, 100));
    return null;
  }
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const s = t.indexOf("{"), end = t.lastIndexOf("}");
  if (s >= 0 && end > s) t = t.slice(s, end + 1);
  try {
    const j = JSON.parse(t) as { ingredients?: unknown; dosage?: unknown };
    const ingredients = Array.isArray(j.ingredients) ? j.ingredients.map((x) => String(x).trim()).filter(Boolean).slice(0, 40) : [];
    const dosage = typeof j.dosage === "string" && j.dosage.trim() ? j.dosage.trim() : undefined;
    if (!ingredients.length && !dosage) return null;
    return { ingredients, dosage };
  } catch {
    return null;
  }
}

const WEBSITE_TOOL: Anthropic.Tool = {
  name: "emit_website_intel",
  description: "Structured, evidence-backed brand intelligence extracted from the brand's website + web research.",
  input_schema: {
    type: "object",
    properties: {
      positioning: { type: "string" },
      value_props: { type: "array", items: { type: "string" } },
      mission: { type: "string" },
      founder_story: { type: "string" },
      voice_samples: { type: "array", items: { type: "string" }, description: "Verbatim on-brand sentences from the site." },
      objections: { type: "array", items: { type: "string" } },
      products: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            ingredients: { type: "array", items: { type: "string" } },
            dosage: { type: "string" },
            format: { type: "string" },
            price: { type: "string" },
            certifications: { type: "array", items: { type: "string" } },
            claims: { type: "array", items: { type: "string" } },
          },
          required: ["name"],
        },
      },
      field_confidence: { type: "number", description: "0..1 overall confidence given the evidence available." },
    },
    required: ["positioning"],
  },
};

/** Website module: homepage text + Tavily web research → structured intel extraction. */
export async function runWebsiteJob(job: JobRow, source: SourceRow): Promise<void> {
  const url = source.url;
  if (!url) throw new Error("website source has no URL");

  const [brand] = await db.select({ name: schema.brands.name }).from(schema.brands).where(eq(schema.brands.id, job.brandId)).limit(1);
  const brandName = brand?.name ?? "";
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep url */ }

  // Crawl the homepage + a few product/about/FAQ pages so we capture ingredients,
  // dosage, founder story etc. — not just the homepage.
  const pages = await crawlBrandSite(url, { maxPages: 6, maxCharsPerPage: 5000 });
  const homeText = pages.map((p) => `[${p.url}]\n${p.text}`).join("\n\n").slice(0, 18000);
  // Shopify storefronts expose a structured catalog at /products.json — pulls the
  // FULL product list with prices + descriptions (often the ingredient/dosage copy).
  let origin = "";
  try { origin = new URL(url).origin; } catch { /* ignore */ }
  const catalog = origin ? await shopifyCatalog(origin) : { summary: "", products: [] };
  // Tavily is enrichment — degrade gracefully if its key is missing or it errors.
  let tav: { answer: string; results: { title: string; url: string; content: string }[] } = { answer: "", results: [] };
  try {
    tav = await tavilySearch({
      query: `${brandName} (${host}) — mission, founder story, products, ingredients, certifications, customer objections`,
      searchDepth: "advanced",
      includeAnswer: true,
      maxResults: 8,
      systemKey: SYSTEM_KEY,
      brandId: job.brandId,
    });
  } catch (e) {
    console.warn("[website] tavily unavailable, using homepage only:", String(e).slice(0, 100));
  }
  if (!homeText && !tav.answer && !tav.results.length) throw new Error("No website content could be fetched (page blocked + no web research available)");

  // raw artifact for the extraction viewer's Raw tab (text is small enough to inline)
  await db
    .insert(schema.rawArtifacts)
    .values({
      brandId: job.brandId,
      jobId: job.id,
      kind: "page",
      externalId: url,
      meta: { url, pages: pages.map((p) => p.url), text: homeText.slice(0, 16000), tavilyAnswer: tav.answer, sources: tav.results.map((r) => ({ title: r.title, url: r.url })) },
    })
    .onConflictDoNothing();

  const context = [
    catalog.summary ? `STORE CATALOG (products.json — the authoritative product list):\n${catalog.summary}` : "",
    homeText ? `SITE PAGES (${pages.length}):\n${homeText.slice(0, 16000)}` : "(site text unavailable)",
    tav.answer ? `\nWEB RESEARCH SUMMARY:\n${tav.answer}` : "",
    `\nSOURCES:\n${tav.results.map((r) => `- ${r.title} (${r.url}): ${r.content}`).join("\n").slice(0, 4000)}`,
  ].join("\n");

  const resp = await callClaude({
    model: "claude-sonnet-4-6",
    maxTokens: 2200,
    system:
      "You extract structured, evidence-backed brand intelligence from a brand's own website + web research. Be concrete and verbatim where possible; never invent. Set field_confidence lower when the evidence is thin or indirect.",
    messages: [{ role: "user", content: `Brand: ${brandName}\nWebsite: ${url}\n\n${context}\n\nReturn the structured intel via emit_website_intel.` }],
    tools: [WEBSITE_TOOL],
    toolChoice: { type: "tool", name: "emit_website_intel" },
    systemKey: SYSTEM_KEY,
    brandId: job.brandId,
  });
  const out = toolResult<Record<string, unknown> & { field_confidence?: number; products?: { name?: string; ingredients?: string[]; dosage?: string; format?: string; price?: string; claims?: string[] }[] }>(resp, "emit_website_intel");
  if (!out) throw new Error("website extraction returned nothing");

  // Catalog is authoritative for the product LIST: seed from products.json, overlay
  // Claude's per-product detail (ingredients/dosage/claims) by name. Reliable, not LLM-dependent.
  if (catalog.products.length) {
    const byName = new Map((out.products ?? []).map((p) => [String(p.name ?? "").toLowerCase().trim(), p]));
    const merged = catalog.products.map((cp) => {
      const cl = byName.get(cp.name.toLowerCase().trim());
      return { name: cp.name, price: cp.price ?? cl?.price, format: cp.format ?? cl?.format, ingredients: cl?.ingredients ?? [], dosage: cl?.dosage, claims: cl?.claims ?? [] };
    });
    // keep any Claude products not present in the catalog (e.g. bundles described only on-page)
    for (const cl of out.products ?? []) {
      if (!catalog.products.some((cp) => cp.name.toLowerCase().trim() === String(cl.name ?? "").toLowerCase().trim())) merged.push(cl as (typeof merged)[number]);
    }
    out.products = merged.slice(0, 60);

    // Ingredient-vision: ingredient/dosage copy lives in PDP label images, not body_html.
    // For the first few products still missing ingredients, read the Supplement Facts panel.
    const imagesByName = new Map(catalog.products.map((cp) => [cp.name.toLowerCase().trim(), cp.images ?? []]));
    const imgsOf = (p: { name?: string }) => imagesByName.get(String(p.name ?? "").toLowerCase().trim()) ?? [];
    const candidates = (out.products as { name?: string; ingredients?: string[]; dosage?: string }[])
      .filter((p) => (!p.ingredients || p.ingredients.length === 0) && imgsOf(p).length > 0);
    // Vision pays off on products with a "label"/"facts"/"ingredients"-named image — do
    // those FIRST (they reliably yield); a couple of non-hinted heroes get a cheap best-
    // effort pass only if budget remains. (Bundles/kits rarely have a facts panel.)
    const hinted = candidates.filter((p) => imgsOf(p).some((u) => LABEL_HINT.test(u)));
    const unhinted = candidates.filter((p) => !imgsOf(p).some((u) => LABEL_HINT.test(u))).slice(0, 2);
    const targets = [...hinted, ...unhinted].slice(0, MAX_VISION_PRODUCTS);
    // Wall-clock budget — this job can be claimed by the 60s tick route; never blow it.
    const visionDeadline = Date.now() + 22_000;
    let visionHits = 0;
    for (const p of targets) {
      if (Date.now() > visionDeadline) { console.log(`[website] ingredient-vision budget hit, stopping early for ${brandName}`); break; }
      const imgs = imagesByName.get(String(p.name ?? "").toLowerCase().trim()) ?? [];
      const got = await ingredientsFromImages(job.brandId, String(p.name ?? "Product"), imgs);
      if (got && (got.ingredients.length || got.dosage)) {
        if (got.ingredients.length) p.ingredients = got.ingredients;
        if (got.dosage && !p.dosage) p.dosage = got.dosage;
        visionHits++;
      }
    }
    if (visionHits) console.log(`[website] ingredient-vision filled ${visionHits}/${targets.length} products for ${brandName}`);
  }

  const confidence = Math.max(0, Math.min(1, typeof out.field_confidence === "number" ? out.field_confidence : 0.6));
  await db
    .insert(schema.extractions)
    .values({ brandId: job.brandId, sourceId: source.id, jobId: job.id, schemaType: "website_intel", json: out, confidence: confidence.toFixed(3), model: "claude-sonnet-4-6" })
    .onConflictDoUpdate({
      target: [schema.extractions.sourceId, schema.extractions.schemaType],
      set: { json: out, confidence: confidence.toFixed(3), jobId: job.id, updatedAt: new Date() },
    });
}
