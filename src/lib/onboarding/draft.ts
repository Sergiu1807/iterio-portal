import type { BrandDraft, PaletteColor, SectionType } from "@/lib/types";

// Curated Soft-Canvas-compatible palettes — picked deterministically per brand.
const PALETTES: { brandColor: string; palette: PaletteColor[] }[] = [
  { brandColor: "#3F7D6E", palette: [{ hex: "#3F7D6E", role: "primary" }, { hex: "#E8DFCB", role: "surface" }, { hex: "#C2785A", role: "accent" }, { hex: "#2A3B34", role: "ink" }] },
  { brandColor: "#B5562B", palette: [{ hex: "#B5562B", role: "primary" }, { hex: "#F2E7D5", role: "surface" }, { hex: "#5A7A64", role: "accent" }, { hex: "#33241B", role: "ink" }] },
  { brandColor: "#6E5A86", palette: [{ hex: "#6E5A86", role: "primary" }, { hex: "#EDE6E0", role: "surface" }, { hex: "#C2785A", role: "accent" }, { hex: "#2C2630", role: "ink" }] },
  { brandColor: "#2F6F8F", palette: [{ hex: "#2F6F8F", role: "primary" }, { hex: "#E7E2D6", role: "surface" }, { hex: "#D08C45", role: "accent" }, { hex: "#243038", role: "ink" }] },
  { brandColor: "#9A4B57", palette: [{ hex: "#9A4B57", role: "primary" }, { hex: "#F0E6DD", role: "surface" }, { hex: "#5E7A66", role: "accent" }, { hex: "#312228", role: "ink" }] },
  { brandColor: "#7A7A2E", palette: [{ hex: "#7A7A2E", role: "primary" }, { hex: "#EDE9D6", role: "surface" }, { hex: "#C2785A", role: "accent" }, { hex: "#2E2E1F", role: "ink" }] },
];

export function pickPalette(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

export const SECTION_BLUEPRINT: { sectionType: SectionType; title: string }[] = [
  { sectionType: "identity", title: "Core Identity & Mission" },
  { sectionType: "audience", title: "Target Customer Profile" },
  { sectionType: "products", title: "Key Products & Services" },
  { sectionType: "usps", title: "Unique Selling Propositions" },
  { sectionType: "voice", title: "Brand Voice & Tone" },
  { sectionType: "visual", title: "Visual Direction" },
  { sectionType: "competitors", title: "Competitor Landscape" },
  { sectionType: "constraints", title: "Creative Constraints & Guardrails" },
];

const TYPE_RULES: [RegExp, SectionType][] = [
  [/identity|mission|about|overview|company|story/i, "identity"],
  [/audience|customer|persona|who we|target/i, "audience"],
  [/product|service|offer|sku|catalog/i, "products"],
  [/usp|differen|unique|why us|advantage|proof/i, "usps"],
  [/voice|tone|messaging|language|copy/i, "voice"],
  [/visual|design|look|aesthetic|palette|colou?r|art/i, "visual"],
  [/competit|rival|landscape/i, "competitors"],
  [/constraint|guardrail|complian|legal|do not|avoid|rule/i, "constraints"],
];

function mapHeadingToType(heading: string): SectionType | "custom" {
  for (const [re, type] of TYPE_RULES) if (re.test(heading)) return type;
  return "custom";
}

/** Split a pasted markdown doc into editable sections by its headings. */
export function parseMarkdownToSections(md: string): BrandDraft["sections"] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const sections: BrandDraft["sections"] = [];
  let current: { title: string; body: string[] } | null = null;
  let preamble: string[] = [];

  const headingRe = /^(#{1,3})\s+(.*)$/;

  for (const line of lines) {
    const m = line.match(headingRe);
    if (m) {
      if (current) {
        sections.push(makeSection(current.title, current.body.join("\n").trim(), sections.length));
      }
      current = { title: m[2].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) {
    sections.push(makeSection(current.title, current.body.join("\n").trim(), sections.length));
  }

  // If there were no headings at all, treat the whole thing as one identity blob.
  if (sections.length === 0 && md.trim()) {
    sections.push(makeSection("Overview", md.trim(), 0));
  } else if (preamble.join("").trim() && sections.length) {
    // Prepend any text before the first heading as an overview.
    sections.unshift(makeSection("Overview", preamble.join("\n").trim(), 0));
    sections.forEach((s, i) => (s.sortOrder = i));
  }

  return sections;
}

function makeSection(title: string, content: string, sortOrder: number): BrandDraft["sections"][number] {
  return { title, sectionType: mapHeadingToType(title), content, sortOrder };
}

export function emptyDraft(source: BrandDraft["onboardingSource"]): BrandDraft {
  return {
    name: "",
    brandColor: "#5A7A64",
    palette: [{ hex: "#5A7A64", role: "primary" }],
    onboardingSource: source,
    sections: [],
    products: [],
    personas: [],
    usps: [],
    competitors: [],
  };
}
