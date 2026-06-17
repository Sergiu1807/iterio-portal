/* Verify the Static Ad prompt builder: real DNA research call + deterministic
 * master-template assembly. No server-only deps. Run: npx tsx scripts/verify-static-setup.ts [slug] */
import { config } from "dotenv";
config({ path: ".env.local" });

import crypto from "node:crypto";
import postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";
import { brandDna } from "../src/systems/static-generation/authoring";
import { renderAgent1, renderAgent2, buildColorSubstitutions, buildCatalog, buildVoiceRules } from "../src/systems/static-generation/templates";
import type { Brand } from "../src/lib/types";

function decryptKey(encrypted: string, secret: string): string {
  const key = crypto.createHash("sha256").update(secret.trim()).digest();
  const [ivHex, tagHex, data] = encrypted.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return d.update(data, "hex", "utf8") + d.final("utf8");
}

const DNA_TOOL = {
  name: "emit_brand_dna",
  description: "Return the brand's visual + verbal DNA.",
  input_schema: {
    type: "object" as const,
    properties: {
      visualLanguageModifier: { type: "string" },
      hexPalette: { type: "array", items: { type: "string" } },
      fonts: { type: "object", properties: { heading: { type: "string" }, body: { type: "string" } } },
      voiceKeywords: { type: "array", items: { type: "string" } },
      emotionalKeywords: { type: "array", items: { type: "string" } },
      proofPoints: { type: "array", items: { type: "string" } },
      dos: { type: "array", items: { type: "string" } },
      donts: { type: "array", items: { type: "string" } },
    },
    required: ["visualLanguageModifier", "hexPalette", "voiceKeywords", "emotionalKeywords"],
  },
};

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
    tagline: b.tagline ?? undefined, vibe: b.vibe ?? undefined, brandColor: b.brand_color, palette: b.palette ?? [], status: "Active", enabledSystems: {},
    sections: sections.map((s, i) => ({ id: String(i), title: s.title, sectionType: s.section_type, content: s.content ?? "", sortOrder: s.sort_order })),
    products: products.map((p, i) => ({ id: String(i), name: p.name, category: p.category ?? undefined, keyBenefits: p.key_benefits ?? undefined, price: p.price ?? undefined, isHero: p.is_hero })),
    personas: [], usps: usps.map((u, i) => ({ id: String(i), text: u.text, isPrimary: u.is_primary })), competitors: [], creativeDna: [], createdAt: "",
  } as unknown as Brand;

  let apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) {
    const [row] = await sql`select encrypted_value from api_keys where key_name='ANTHROPIC_API_KEY'`;
    if (row?.encrypted_value) apiKey = decryptKey(row.encrypted_value, process.env.API_KEYS_ENCRYPTION_SECRET!);
  }
  if (!apiKey) throw new Error("No ANTHROPIC_API_KEY");

  console.log(`\n=== Brand DNA research for ${brand.name} ===`);
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2500,
    system:
      'You are a senior brand strategist reverse-engineering a brand\'s visual and verbal identity. Use exact hex (prefer the confirmed palette). visualLanguageModifier must be 50–75 words and begin exactly "Shoot in the <Brand> visual language:". Never fabricate stats.',
    tools: [DNA_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "emit_brand_dna" },
    messages: [{ role: "user", content: `Reverse-engineer the DNA. Confirmed palette hexes below — use exactly.\n\n${brandDna(brand, null)}` }],
  });
  const dna = (resp.content.find((c) => c.type === "tool_use") as { input: Record<string, unknown> }).input as Record<string, unknown>;

  console.log("modifier:", dna.visualLanguageModifier);
  console.log("hexPalette:", dna.hexPalette);
  console.log("voice:", dna.voiceKeywords, "| emotional:", dna.emotionalKeywords);

  const slots = {
    brandName: brand.name,
    brandType: "products" as const,
    visualLanguageModifier: dna.visualLanguageModifier as string,
    colorSubstitutions: buildColorSubstitutions(brand.palette, (dna.hexPalette as string[]) ?? [], dna.fonts as { heading?: string; body?: string }),
    catalog: buildCatalog(brand.products.map((p) => ({ name: p.name, paragraph: p.keyBenefits || p.name }))),
    voiceRules: buildVoiceRules({ voiceKeywords: dna.voiceKeywords as string[], emotionalKeywords: dna.emotionalKeywords as string[], proofPoints: dna.proofPoints as string[], usps: brand.usps.map((u) => u.text) }),
  };
  const agent1 = renderAgent1({ vertical: brand.category || "DTC consumer", brandType: "products" });
  const agent2 = renderAgent2(slots);

  console.log("\n--- assembled agent2 checks ---");
  console.log("length:", agent2.length, "chars");
  console.log("opens-with-contract:", agent2.includes('Begins exactly: "Use the attached images as brand reference."'));
  console.log("modifier embedded:", agent2.includes(dna.visualLanguageModifier as string));
  console.log("catalog marked verbatim:", agent2.includes("USE EXACTLY AS WRITTEN"));
  console.log("layer discipline:", agent2.includes("LAYER DISCIPLINE"));
  console.log("hexes in color subs:", (slots.colorSubstitutions.match(/#[0-9a-f]{6}/gi) || []).length);
  console.log("agent1 length:", agent1.length, "| JSON-only:", /Raw JSON only/i.test(agent1));
  console.log("\n--- agent2 (first 1000 chars) ---\n" + agent2.slice(0, 1000));
  console.log("tokens:", resp.usage.input_tokens, "in /", resp.usage.output_tokens, "out");

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
