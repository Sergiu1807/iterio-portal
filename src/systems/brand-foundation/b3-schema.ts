// The Brand Intelligence (B3) object — the single, versioned grounding source
// every downstream creative system reads via getApprovedBrandIntelligence().
// All fields optional so partial drafts (and the manual P1 editor) are valid.

export type B3Persona = {
  name?: string;
  demographics?: string;
  psychographics?: string;
  jobs_to_be_done?: string[];
  pains?: string[];
  desires?: string[];
  objections?: string[];
  their_words?: string[]; // verbatim VOC phrases
};

export type B3ProofMechanism = {
  type?: "clinical" | "ingredient" | "social" | "founder" | "certification" | string;
  detail?: string;
  evidence?: string;
};

export type B3Offer = { name?: string; pricing?: string; subscription?: string; promo?: string };

export type B3Product = {
  name?: string;
  is_hero?: boolean;
  ingredients?: string[];
  dosage?: string;
  format?: string;
  price?: string;
  certifications?: string[];
  claims_made?: string[];
  image_keys?: string[]; // brand_assets storageKeys
};

export type B3ComplianceRule = { subject?: string; jurisdiction?: string; verdict?: string; rationale?: string };

export type B3WinnerPattern = {
  angle?: string;
  hook?: string;
  format?: string;
  why_it_wins?: string;
  source_ref?: string;
  thumb_key?: string;
};

export type B3SourceRef = { sourceId?: string; extractionId?: string; kind?: string };
export type B3Gap = { field: string; severity: "low" | "medium" | "high" | string; reason: string };

export type B3 = {
  brand_snapshot?: { name?: string; category?: string; one_liner?: string; mission?: string; founder_story?: string };
  positioning?: { statement?: string; differentiators?: string[]; category_belief?: string; enemy?: string; price_tier?: string };
  personas?: B3Persona[];
  emotional_triggers?: string[];
  proof_mechanisms?: B3ProofMechanism[];
  offers?: B3Offer[];
  products?: B3Product[];
  compliance?: { summary?: string; rules?: B3ComplianceRule[]; banned_phrasings?: string[]; required_disclaimers?: string[] };
  creative_dna?: {
    palette?: { hex: string; role?: string }[];
    fonts?: { display?: string; body?: string };
    logo_key?: string;
    visual_style?: string;
    do?: string[];
    dont?: string[];
    reference_asset_keys?: string[];
  };
  voice_profile?: { tone?: string; vocabulary?: string[]; sentence_style?: string; banned_words?: string[]; examples?: string[] };
  winner_patterns?: { own?: B3WinnerPattern[]; competitor?: B3WinnerPattern[]; category?: B3WinnerPattern[] };
  gap_analysis?: { unmet_desires?: string[]; whitespace_angles?: string[] };
  channels?: { channel?: string; notes?: string; what_works?: string }[];
  meta?: {
    confidence_scores?: Record<string, number>; // field path → 0..1
    gaps?: B3Gap[];
    source_refs?: Record<string, B3SourceRef[]>; // field path → refs
    version?: number;
    generated_at?: string;
  };
};

/** Top-level B3 section keys the editor renders as tabs. */
export const B3_SECTIONS = [
  "brand_snapshot",
  "positioning",
  "personas",
  "emotional_triggers",
  "proof_mechanisms",
  "offers",
  "products",
  "voice_profile",
  "creative_dna",
  "winner_patterns",
  "compliance",
  "channels",
  "gap_analysis",
] as const;

/** A minimal, valid B3 to seed a fresh draft (optionally pre-filled from the brand). */
export function blankB3(seed?: { name?: string; category?: string }): B3 {
  return {
    brand_snapshot: { name: seed?.name ?? "", category: seed?.category ?? "" },
    positioning: { statement: "", differentiators: [] },
    personas: [],
    emotional_triggers: [],
    proof_mechanisms: [],
    offers: [],
    products: [],
    compliance: { rules: [], banned_phrasings: [], required_disclaimers: [] },
    creative_dna: { palette: [], do: [], dont: [], reference_asset_keys: [] },
    voice_profile: { vocabulary: [], banned_words: [], examples: [] },
    winner_patterns: { own: [], competitor: [], category: [] },
    gap_analysis: { unmet_desires: [], whitespace_angles: [] },
    channels: [],
    meta: { confidence_scores: {}, gaps: [], source_refs: {}, version: 0 },
  };
}
