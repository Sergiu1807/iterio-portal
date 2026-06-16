/* Verify the Static Ad prompt builder produces contract-valid output.
 * Runs the real authoring Claude call against a brand's DNA. No server-only deps.
 * Run: npx tsx scripts/verify-static-setup.ts [brandSlug] */
import { config } from "dotenv";
config({ path: ".env.local" });

import crypto from "node:crypto";
import postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";
import { brandDna, PROMPTS_TOOL, authorSystemPrompt } from "../src/systems/static-generation/authoring";
import { buildPlaceholderConfig } from "../src/systems/static-generation/placeholder-prompts";
import type { Brand } from "../src/lib/types";

function decryptKey(encrypted: string, secret: string): string {
  const key = crypto.createHash("sha256").update(secret.trim()).digest();
  const [ivHex, tagHex, data] = encrypted.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(data, "hex", "utf8") + decipher.final("utf8");
}

async function main() {
  const slug = process.argv[2] || "lumara";
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 1 });

  const [b] = await sql`select * from brands where slug=${slug}`;
  if (!b) throw new Error(`no brand '${slug}'`);
  const sections = await sql`select title, section_type, content, sort_order from intelligence_sections where brand_id=${b.id} order by sort_order`;
  const products = await sql`select name, category, key_benefits, price, is_hero from products where brand_id=${b.id}`;
  const usps = await sql`select text, is_primary from usps where brand_id=${b.id}`;

  const brand = {
    id: b.id, name: b.name, slug: b.slug, website: b.website ?? undefined, category: b.category ?? undefined,
    tagline: b.tagline ?? undefined, vibe: b.vibe ?? undefined, brandColor: b.brand_color,
    palette: b.palette ?? [], status: "Active", enabledSystems: {},
    sections: sections.map((s, i) => ({ id: String(i), title: s.title, sectionType: s.section_type, content: s.content ?? "", sortOrder: s.sort_order })),
    products: products.map((p, i) => ({ id: String(i), name: p.name, category: p.category ?? undefined, keyBenefits: p.key_benefits ?? undefined, price: p.price ?? undefined, isHero: p.is_hero })),
    personas: [], usps: usps.map((u, i) => ({ id: String(i), text: u.text, isPrimary: u.is_primary })), competitors: [], creativeDna: [], createdAt: "",
  } as unknown as Brand;

  // Resolve the Anthropic key the app's way: DB api_keys (decrypt) → env.
  let apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) {
    const [row] = await sql`select encrypted_value from api_keys where key_name='ANTHROPIC_API_KEY'`;
    if (row?.encrypted_value) apiKey = decryptKey(row.encrypted_value, process.env.API_KEYS_ENCRYPTION_SECRET!);
  }
  if (!apiKey) throw new Error("No ANTHROPIC_API_KEY (env or DB)");

  const template = buildPlaceholderConfig({ brandName: brand.name, website: brand.website, brandColor: brand.brandColor });
  console.log(`\n=== Authoring static-agent prompts for ${brand.name} ===`);
  console.log("DNA chars:", brandDna(brand, null).length, "| sections:", brand.sections.length, "| products:", brand.products.length);

  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: authorSystemPrompt(template),
    tools: [PROMPTS_TOOL],
    tool_choice: { type: "tool", name: "emit_static_prompts" },
    messages: [{ role: "user", content: `Author the four prompts for this brand, grounded in its DNA:\n\n${brandDna(brand, null)}` }],
  });

  const block = resp.content.find((c) => c.type === "tool_use") as { input: Record<string, string> } | undefined;
  if (!block) throw new Error("no tool_use in response");
  const out = block.input;

  const a1 = out.agent1Prompt || "";
  const a2 = out.agent2Prompt || "";
  console.log("\n--- contract checks ---");
  console.log("agent1 mentions JSON-only:", /json/i.test(a1) && /only/i.test(a1), `(${a1.length} chars)`);
  console.log("agent2 ends-with-aspect-ratio instruction:", /aspect ratio/i.test(a2), `(${a2.length} chars)`);
  console.log("brief prompts present:", !!out.briefAgent1Prompt, !!out.briefAgent2Prompt);
  console.log("brand name woven into agent2:", a2.toLowerCase().includes(brand.name.toLowerCase()));
  console.log("\n--- agent2Prompt (first 900 chars) ---\n" + a2.slice(0, 900));
  console.log("\ntokens:", resp.usage.input_tokens, "in /", resp.usage.output_tokens, "out");

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
