// Domain model for the Iterio Portal.
// (No DB yet — these are plain shapes held in the client-side store.)

export type SectionType =
  | "identity"
  | "audience"
  | "products"
  | "usps"
  | "voice"
  | "visual"
  | "competitors"
  | "constraints";

export interface BrandIntelSection {
  id: string;
  title: string;
  sectionType: SectionType | string;
  content: string;
  sortOrder: number;
}

export interface Product {
  id: string;
  name: string;
  category?: string;
  keyBenefits?: string;
  price?: string;
  productUrl?: string;
  imageUrl?: string; // 1:1 — Static Generation
  videoImageUrl?: string; // 9:16 — Video Generation
  isHero?: boolean;
}

export interface Persona {
  id: string;
  name: string;
  demographics?: string;
  psychographics?: string;
  painPoints?: string;
  desires?: string;
}

export interface Usp {
  id: string;
  text: string;
  category?: string;
  isPrimary?: boolean;
}

export interface Competitor {
  id: string;
  name: string;
  websiteUrl?: string;
  instagramHandle?: string;
  tiktokHandle?: string;
  type?: string;
}

export interface CreativeDna {
  id: string;
  attributeName: string;
  value: string;
}

export interface PaletteColor {
  hex: string;
  role: string;
}

export type OnboardingSource = "research" | "paste" | "wizard";

export interface Brand {
  id: string;
  name: string;
  slug: string;
  website?: string;
  category?: string;
  primaryMarket?: string;
  currency?: string;
  tagline?: string;
  vibe?: string;
  /** hex — drives the per-brand tint wash + monogram */
  brandColor: string;
  palette: PaletteColor[];
  fonts?: { display?: string; body?: string };
  cluster?: string;
  status: "Active" | "Draft" | "Archived";
  onboardingSource?: OnboardingSource;
  /** keyed by system registry key */
  enabledSystems: Record<string, boolean>;
  sections: BrandIntelSection[];
  products: Product[];
  personas: Persona[];
  usps: Usp[];
  competitors: Competitor[];
  creativeDna: CreativeDna[];
  createdAt: string;
}

/** The reviewable draft produced by every onboarding path. */
export interface BrandDraft {
  name: string;
  website?: string;
  category?: string;
  primaryMarket?: string;
  currency?: string;
  tagline?: string;
  vibe?: string;
  brandColor: string;
  palette: PaletteColor[];
  cluster?: string;
  onboardingSource: OnboardingSource;
  sections: Omit<BrandIntelSection, "id">[];
  products: Omit<Product, "id">[];
  personas: Omit<Persona, "id">[];
  usps: Omit<Usp, "id">[];
  competitors: Omit<Competitor, "id">[];
}
