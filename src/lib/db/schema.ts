import {
  pgTable,
  text,
  boolean,
  timestamp,
  uuid,
  jsonb,
  integer,
  numeric,
  bigserial,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { PaletteColor, SectionType } from "../types";

// =============================================
// PROFILES (1:1 with Supabase auth.users)
// The FK to auth.users + the insert trigger live in supabase/migrations SQL.
// =============================================

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // == auth.users.id
  email: text("email"),
  role: text("role").notNull().default("member"), // admin | member | viewer
  displayName: text("display_name"),
  lastBrandId: uuid("last_brand_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================
// BRANDS (hub) + sub-resources (all brand_id, cascade)
// =============================================

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").references(() => profiles.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    website: text("website"),
    category: text("category"),
    primaryMarket: text("primary_market"),
    currency: text("currency"),
    tagline: text("tagline"),
    vibe: text("vibe"),
    brandColor: text("brand_color").notNull().default("#5A7A64"),
    palette: jsonb("palette").$type<PaletteColor[]>().notNull().default([]),
    fonts: jsonb("fonts").$type<{ display?: string; body?: string }>().notNull().default({}),
    cluster: text("cluster"),
    status: text("status").notNull().default("Active"),
    onboardingSource: text("onboarding_source"), // research | paste | wizard
    enabledSystems: jsonb("enabled_systems").$type<Record<string, boolean>>().notNull().default({}),
    storagePrefix: text("storage_prefix").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("brands_owner_idx").on(t.ownerId)]
);

export const intelligenceSections = pgTable(
  "intelligence_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sectionType: text("section_type").$type<SectionType | string>(),
    content: text("content"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("intel_brand_idx").on(t.brandId)]
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category"),
    keyBenefits: text("key_benefits"),
    price: text("price"),
    productUrl: text("product_url"),
    imageUrl: text("image_url"), // 1:1 — Static Generation
    videoImageUrl: text("video_image_url"), // 9:16 — Video Generation
    isHero: boolean("is_hero").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_brand_idx").on(t.brandId)]
);

export const personas = pgTable(
  "personas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    demographics: text("demographics"),
    psychographics: text("psychographics"),
    painPoints: text("pain_points"),
    desires: text("desires"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("personas_brand_idx").on(t.brandId)]
);

export const usps = pgTable(
  "usps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    category: text("category"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usps_brand_idx").on(t.brandId)]
);

// Doubles as the competitor SCRAPER source list (meta_page_id / search terms / handles).
export const competitors = pgTable(
  "competitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    websiteUrl: text("website_url"),
    instagramHandle: text("instagram_handle"),
    tiktokHandle: text("tiktok_handle"),
    metaPageId: text("meta_page_id"),
    metaSearchTerms: text("meta_search_terms"),
    metaLibraryUrl: text("meta_library_url"),
    country: text("country").notNull().default("ALL"),
    type: text("type"),
    niche: text("niche"), // inferred/curated; the swipe library compounds per niche
    isActive: boolean("is_active").notNull().default(true),
    radarEnabled: boolean("radar_enabled").notNull().default(false), // pin for the weekly radar re-scrape
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("competitors_brand_idx").on(t.brandId)]
);

// =============================================
// API KEYS (encrypted at rest) — admin-managed
// =============================================

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  keyName: text("key_name").notNull().unique(),
  encryptedValue: text("encrypted_value").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

// =============================================
// USAGE EVENTS (unified metering — every external call)
// =============================================

export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    provider: text("provider").notNull(), // anthropic | gemini | apify
    systemKey: text("system_key"), // registry key, e.g. competitor-research
    brandId: uuid("brand_id"),
    keyName: text("key_name"), // which api_keys row
    model: text("model"),
    units: jsonb("units").$type<Record<string, number>>().notNull().default({}),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("usage_provider_created_idx").on(t.provider, t.createdAt),
    index("usage_system_created_idx").on(t.systemKey, t.createdAt),
    index("usage_brand_created_idx").on(t.brandId, t.createdAt),
  ]
);

// =============================================
// SCRAPE JOBS (async pipeline backbone) — Competitor Research
// =============================================

export const scrapeJobs = pgTable(
  "scrape_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    competitorId: uuid("competitor_id").references(() => competitors.id, { onDelete: "set null" }),
    systemKey: text("system_key").notNull().default("competitor-research"),
    platform: text("platform").notNull().default("meta"), // meta | tiktok | instagram
    mode: text("mode").notNull().default("page_id"), // keyword | page_id
    query: text("query").notNull(),
    country: text("country").notNull().default("ALL"),
    requestedCount: integer("requested_count").notNull().default(20),
    niche: text("niche"), // snapshot of the competitor's niche at scrape time
    // pending | running | ingesting | analyzing | scoring | complete | error
    status: text("status").notNull().default("pending"),
    apifyRunId: text("apify_run_id"),
    apifyDatasetId: text("apify_dataset_id"),
    stats: jsonb("stats").$type<{ adsFound?: number; adsNew?: number; adsAnalyzed?: number; conceptsScored?: number }>().notNull().default({}),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scrape_jobs_brand_idx").on(t.brandId),
    index("scrape_jobs_status_idx").on(t.status),
  ]
);

// =============================================
// COMPETITOR ADS (scraped + analyzed)
// =============================================

export const competitorAds = pgTable(
  "competitor_ads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    scrapeJobId: uuid("scrape_job_id").references(() => scrapeJobs.id, { onDelete: "set null" }),
    // identity / dedup
    adArchiveId: text("ad_archive_id").notNull(),
    adGroupId: text("ad_group_id"),
    collationId: text("collation_id"),
    competitorPageId: text("competitor_page_id"),
    brandPageName: text("brand_page_name"),
    dedupCount: integer("dedup_count").notNull().default(1),
    // snapshot / sort
    snapshotId: text("snapshot_id"),
    snapshotDate: timestamp("snapshot_date", { withTimezone: true }),
    adStartDate: timestamp("ad_start_date", { withTimezone: true }),
    metaSortRank: integer("meta_sort_rank"),
    isDco: boolean("is_dco").notNull().default(false),
    // media (stored as Supabase Storage paths)
    mediaType: text("media_type"), // video | image | carousel | text
    primaryThumbnail: text("primary_thumbnail"), // poster image path
    videoPath: text("video_path"), // stored full video path (video ads)
    mediaCards: jsonb("media_cards").$type<string[]>().notNull().default([]), // carousel image paths (legacy/grid)
    // per-card media (ordered), so a carousel can show ALL its slides — images and/or videos
    mediaCardItems: jsonb("media_card_items").$type<{ image: string | null; video: string | null }[]>().notNull().default([]),
    fullMediaAsset: text("full_media_asset"),
    platformsDisplay: text("platforms_display"),
    // media capture diagnostics + backfill
    mediaCaptureFailed: boolean("media_capture_failed").notNull().default(false),
    mediaCaptureAttempts: integer("media_capture_attempts").notNull().default(0),
    sourceMediaUrls: jsonb("source_media_urls").$type<{ thumbnailUrl?: string; videoUrl?: string; carouselImageUrls?: string[] }>(),
    // ad copy
    displayPrimaryText: text("display_primary_text"),
    headlineTitle: text("headline_title"),
    ctaButtonType: text("cta_button_type"),
    destinationUrl: text("destination_url"),
    displayDomain: text("display_domain"),
    adLibraryUrl: text("ad_library_url"),
    publisherPlatforms: jsonb("publisher_platforms").$type<string[]>().notNull().default([]),
    // AI analysis (9 fields)
    creativeAngle: text("creative_angle"),
    adDescription: text("ad_description"),
    targetPersona: text("target_persona"),
    coreMotivation: text("core_motivation"),
    proofMechanism: text("proof_mechanism"),
    visualHook: text("visual_hook"),
    spokenHook: text("spoken_hook"),
    outroOffer: text("outro_offer"),
    fullTranscript: text("full_transcript"),
    geminiDescription: text("gemini_description"),
    // richer teardown (additive — backfilled lazily by the upgraded analyzer)
    awarenessLevel: text("awareness_level"), // unaware | problem | solution | product | most
    emotionalDriver: text("emotional_driver"), // Dream|Nightmare|Speed|Delay|Certainty|Risk|Ease|Difficulty
    secondaryDrivers: jsonb("secondary_drivers").$type<string[]>().notNull().default([]),
    beatStructure: jsonb("beat_structure").$type<{ beat: string; text: string }[]>().notNull().default([]),
    visualNotes: text("visual_notes"),
    nativeScore: numeric("native_score", { precision: 4, scale: 3 }), // 0.000–1.000
    complianceFlags: jsonb("compliance_flags").$type<string[]>().notNull().default([]),
    // activity tracking (winner scoring) — nullable/defaulted so the migration is non-destructive
    stillActive: boolean("still_active"), // unknown until a status-scrape sees it
    firstSeenActive: timestamp("first_seen_active", { withTimezone: true }),
    lastSeenActive: timestamp("last_seen_active", { withTimezone: true }),
    activeDays: integer("active_days"),
    resurrected: boolean("resurrected").notNull().default(false),
    conceptId: uuid("concept_id"), // FK → concept_clusters.id (set in the scoring pass)
    // analysis queue: queued | processing | complete | failed
    aiAnalysisStatus: text("ai_analysis_status").notNull().default("queued"),
    aiErrorMessage: text("ai_error_message"),
    aiAttempts: integer("ai_attempts").notNull().default(0),
    aiLastAnalyzedAt: timestamp("ai_last_analyzed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("competitor_ads_brand_archive_uidx").on(t.brandId, t.adArchiveId),
    index("competitor_ads_brand_idx").on(t.brandId),
    index("competitor_ads_analysis_status_idx").on(t.aiAnalysisStatus),
    index("competitor_ads_concept_idx").on(t.conceptId),
  ]
);

// =============================================
// CONCEPT CLUSTERS — variant grouping + composite Winner Score
// One row per (brandId, conceptKey); the unique key makes re-runs idempotent.
// =============================================

export const conceptClusters = pgTable(
  "concept_clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    competitorId: uuid("competitor_id").references(() => competitors.id, { onDelete: "set null" }),
    conceptKey: text("concept_key").notNull(), // collation:<id> | adgroup:<id> | texthash:<hash>
    clusterMethod: text("cluster_method").notNull(), // collation | ad_group | text_hash
    advertiser: text("advertiser"),
    representativeAdId: uuid("representative_ad_id"), // ad whose teardown the Angle Bank inherits
    // aggregated signals (recomputed each scoring pass)
    activeVariantCount: integer("active_variant_count").notNull().default(0),
    totalVariantCount: integer("total_variant_count").notNull().default(0),
    distinctFormats: integer("distinct_formats").notNull().default(0),
    formats: jsonb("formats").$type<string[]>().notNull().default([]),
    firstSeen: timestamp("first_seen", { withTimezone: true }),
    lastSeenActive: timestamp("last_seen_active", { withTimezone: true }),
    activeDays: integer("active_days").notNull().default(0),
    peakActiveDays: integer("peak_active_days").notNull().default(0),
    stillActive: boolean("still_active").notNull().default(false),
    resurrected: boolean("resurrected").notNull().default(false),
    // reach (v1: null — renormalize path)
    euTotalReach: integer("eu_total_reach"),
    euReachPerDay: numeric("eu_reach_per_day", { precision: 12, scale: 2 }),
    // score output
    winnerScore: integer("winner_score").notNull().default(0),
    winnerTier: text("winner_tier"), // proven_control | scaling_now | in_testing | historical_swipe | null
    confidence: text("confidence").notNull().default("low"), // high | medium | low
    // time series → WoW momentum
    countHistory: jsonb("count_history")
      .$type<{ runId: string; at: string; activeVariantCount: number; activeAdIds: string[]; score: number }[]>()
      .notNull()
      .default([]),
    lastScoredRunId: uuid("last_scored_run_id"), // idempotency guard for the history append
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("concept_clusters_brand_key_uidx").on(t.brandId, t.conceptKey),
    index("concept_clusters_brand_idx").on(t.brandId),
    index("concept_clusters_score_idx").on(t.brandId, t.winnerScore),
  ]
);

// =============================================
// ANGLE BANK ENTRIES — structured teardown per concept (the research output + remake input)
// =============================================

export const angleBankEntries = pgTable(
  "angle_bank_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id").notNull().references(() => conceptClusters.id, { onDelete: "cascade" }),
    representativeAdId: uuid("representative_ad_id").references(() => competitorAds.id, { onDelete: "set null" }),
    advertiser: text("advertiser"),
    firstSeen: timestamp("first_seen", { withTimezone: true }),
    lastSeenActive: timestamp("last_seen_active", { withTimezone: true }),
    stillActive: boolean("still_active").notNull().default(false),
    format: text("format"),
    platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
    // teardown (inherited from the representative ad's enriched analysis)
    offer: text("offer"),
    angle: text("angle"),
    hook: text("hook"),
    mechanism: text("mechanism"),
    awarenessLevel: text("awareness_level"),
    emotionalDriver: text("emotional_driver"),
    secondaryDrivers: jsonb("secondary_drivers").$type<string[]>().notNull().default([]),
    beatStructure: jsonb("beat_structure").$type<{ beat: string; text: string }[]>().notNull().default([]),
    visualNotes: text("visual_notes"),
    nativeScore: numeric("native_score", { precision: 4, scale: 3 }),
    complianceFlags: jsonb("compliance_flags").$type<string[]>().notNull().default([]),
    // score snapshot (denormalized from the concept for the Angle Bank card)
    winnerScore: integer("winner_score").notNull().default(0),
    winnerTier: text("winner_tier"),
    signals: jsonb("signals").$type<{
      activeDays: number;
      activeVariants: number;
      euTotalReach: number | null;
      euReachPerDay: number | null;
      relaunched: boolean;
      formats: string[];
    }>(),
    confidence: text("confidence").notNull().default("low"),
    // curation lifecycle
    status: text("status").notNull().default("raw"), // raw | approved
    usedInGenerations: jsonb("used_in_generations").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("angle_bank_concept_uidx").on(t.conceptId),
    index("angle_bank_brand_idx").on(t.brandId),
    index("angle_bank_status_idx").on(t.brandId, t.status),
  ]
);

// =============================================
// SWIPE LIBRARY — saved/curated winners; compounds per niche
// =============================================

export const swipeLibrary = pgTable(
  "swipe_library",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    angleBankEntryId: uuid("angle_bank_entry_id").references(() => angleBankEntries.id, { onDelete: "set null" }),
    conceptId: uuid("concept_id").references(() => conceptClusters.id, { onDelete: "set null" }),
    niche: text("niche"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    note: text("note"),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>(), // survives concept deletion
    savedBy: uuid("saved_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("swipe_brand_idx").on(t.brandId),
    index("swipe_niche_idx").on(t.niche),
  ]
);

// =============================================
// STATIC AD GENERATION
// Per-brand agent prompts + generated images + a per-brand reference library.
// =============================================

// One row per brand: the two-agent system prompts + brand logo, authored by the
// "Set up Static system" prompt builder. Placeholder prompts work out of the box.
export const staticAdConfig = pgTable("static_ad_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id").notNull().unique().references(() => brands.id, { onDelete: "cascade" }),
  agent1Prompt: text("agent1_prompt").notNull(), // vision: reference ad → structured JSON
  agent2Prompt: text("agent2_prompt").notNull(), // composer: brief + product + voice → image prompt
  briefAgent1Prompt: text("brief_agent1_prompt"), // brief-mode analyzer (optional)
  briefAgent2Prompt: text("brief_agent2_prompt"), // brief-mode composer (optional)
  brandLogoPath: text("brand_logo_path"), // Supabase path; gates "Refine logo"
  status: text("status").notNull().default("placeholder"), // placeholder | building | ready | error
  isPlaceholder: boolean("is_placeholder").notNull().default(true),
  buildError: text("build_error"),
  builtAt: timestamp("built_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per generated image (incl. refine/edit derivatives).
export const staticAdGenerations = pgTable(
  "static_ad_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    mode: text("mode").notNull().default("custom"), // custom | brief | refined | edited
    status: text("status").notNull().default("pending"), // pending | generating | completed | error
    kieModel: text("kie_model"), // nano-banana-2 | gpt-image-2-image-to-image
    kieJobId: text("kie_job_id"),
    aspectRatio: text("aspect_ratio").notNull().default("1:1"),
    resolution: text("resolution").notNull().default("2K"),
    outputFormat: text("output_format").notNull().default("png"),
    finalPrompt: text("final_prompt"), // Agent 2 output (Nano Banana prompt)
    analysisJson: text("analysis_json"), // Agent 1 output
    referencePath: text("reference_path"), // reference image used (Supabase path)
    adCopy: text("ad_copy"),
    imagePath: text("image_path"), // final stored image (Supabase path)
    batchId: uuid("batch_id"),
    batchIndex: integer("batch_index").notNull().default(1),
    batchSize: integer("batch_size").notNull().default(1),
    sourceGenerationId: uuid("source_generation_id"), // parent for refined/edited rows
    attempts: integer("attempts").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("static_gen_brand_status_idx").on(t.brandId, t.status),
    index("static_gen_batch_idx").on(t.batchId),
  ]
);

// Per-brand reference-image library (replaces the global inspiration library).
export const staticReferences = pgTable(
  "static_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    name: text("name"),
    imagePath: text("image_path").notNull(), // Supabase path
    tags: text("tags"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("static_ref_brand_idx").on(t.brandId)]
);

// =============================================
// VIDEO GENERATION
// Universal prompts (in code) — no per-brand config table. Per-brand Characters
// & Scenes libraries feed A-Roll / UGC-with-character modes.
// =============================================

// Per-brand reusable talent references.
export const videoCharacters = pgTable(
  "video_characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"), // appearance / personality / voice style
    imagePath: text("image_path").notNull(), // Supabase path (headshot/reference)
    analysisJson: text("analysis_json"),
    tags: text("tags"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("video_char_brand_idx").on(t.brandId)]
);

// Per-brand reusable scene/background references (podcast etc.).
export const videoScenes = pgTable(
  "video_scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    imagePath: text("image_path").notNull(),
    analysisJson: text("analysis_json"),
    tags: text("tags"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("video_scene_brand_idx").on(t.brandId)]
);

// One row per generated video.
export const videoGenerations = pgTable(
  "video_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    characterId: uuid("character_id").references(() => videoCharacters.id, { onDelete: "set null" }),
    sceneId: uuid("scene_id").references(() => videoScenes.id, { onDelete: "set null" }),
    videoType: text("video_type").notNull().default("ugc"), // ugc | broll | aroll
    arollStyle: text("aroll_style"), // street-interview | talking-head | podcast | green-screen
    mode: text("mode").notNull().default("ugc"), // descriptive sub-mode (product_only | product_character | no_ref | ...)
    status: text("status").notNull().default("pending"), // pending | generating | completed | error
    kieModel: text("kie_model"),
    kieJobId: text("kie_job_id"),
    duration: integer("duration").notNull().default(10),
    aspectRatio: text("aspect_ratio").notNull().default("9:16"),
    resolution: text("resolution").notNull().default("720p"),
    outputFormat: text("output_format").notNull().default("mp4"),
    script: text("script"),
    // pipeline intermediates (inspection)
    crafterPrompt: text("crafter_prompt"),
    studioFlowPrompt: text("studio_flow_prompt"),
    finalPrompt: text("final_prompt"),
    videoPath: text("video_path"), // stored mp4 (Supabase path)
    thumbnailPath: text("thumbnail_path"),
    batchId: uuid("batch_id"),
    batchIndex: integer("batch_index").notNull().default(1),
    batchSize: integer("batch_size").notNull().default(1),
    sourceGenerationId: uuid("source_generation_id"),
    attempts: integer("attempts").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("video_gen_brand_status_idx").on(t.brandId, t.status),
    index("video_gen_batch_idx").on(t.batchId),
  ]
);

// =============================================
// BRAND ONBOARDING & FOUNDATION LAYER (B3)
// Versioned Brand Intelligence + the research pipeline that feeds it.
// =============================================

// Operator-entered research sources for a brand (one per URL/handle).
export const brandSources = pgTable(
  "brand_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    // website | meta_ads | competitor | amazon | trustpilot | google_reviews | reddit | social | email | upload
    type: text("type").notNull(),
    url: text("url"),
    handle: text("handle"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}), // {country, maxItems, scrapeJobIds?, competitorIds?, site?, platform?}
    // idle | queued | running | complete | failed | partial
    status: text("status").notNull().default("idle"),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("brand_sources_brand_type_url_uidx").on(t.brandId, t.type, t.url),
    index("brand_sources_brand_idx").on(t.brandId),
  ]
);

// One worker row per research stage (P2+). Mirrors the competitor scrape_jobs FSM.
export const researchJobs = pgTable(
  "research_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => brandSources.id, { onDelete: "cascade" }),
    module: text("module").notNull(), // website|reviews|compliance|meta_ads|competitor|assets
    type: text("type").notNull().default("fetch"), // fetch | extract | delegated
    status: text("status").notNull().default("pending"), // pending | running | complete | failed
    provider: text("provider"), // apify | tavily | gemini | claude | internal
    apifyRunId: text("apify_run_id"),
    apifyDatasetId: text("apify_dataset_id"),
    costCents: integer("cost_cents").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    error: text("error"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("research_jobs_brand_status_idx").on(t.brandId, t.status),
    index("research_jobs_source_idx").on(t.sourceId),
  ]
);

// Large raw blobs live in Supabase storage; the row holds the key + metadata.
export const rawArtifacts = pgTable(
  "raw_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => researchJobs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // page | ad | review | post | transcript | asset
    storageKey: text("storage_key"),
    externalId: text("external_id"), // dedup key (review id, post permalink hash, page-url hash)
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("raw_artifacts_job_external_uidx").on(t.jobId, t.kind, t.externalId),
    index("raw_artifacts_brand_idx").on(t.brandId),
  ]
);

// Structured AI extraction per source (one current row per (source, schemaType); re-run upserts).
export const extractions = pgTable(
  "extractions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => brandSources.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => researchJobs.id, { onDelete: "set null" }),
    schemaType: text("schema_type").notNull(), // website_intel | voc | compliance | ...
    json: jsonb("json").$type<Record<string, unknown>>().notNull().default({}),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("extractions_source_schema_uidx").on(t.sourceId, t.schemaType),
    index("extractions_brand_schema_idx").on(t.brandId, t.schemaType),
  ]
);

// Brand assets (operator uploads + auto-pulled PDP images), stored in Supabase.
export const brandAssets = pgTable(
  "brand_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // logo | font | palette | brand_book | product_photo | packaging | winning_creative
    storageKey: text("storage_key").notNull(),
    sourceId: uuid("source_id").references(() => brandSources.id, { onDelete: "set null" }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}), // {origin, productUrl, width, height, hex?, filename, contentType}
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("brand_assets_brand_key_uidx").on(t.brandId, t.storageKey),
    index("brand_assets_brand_type_idx").on(t.brandId, t.type),
  ]
);

// Brand-specific, jurisdiction-aware compliance ruleset (P3).
export const complianceRules = pgTable(
  "compliance_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(), // ingredient or claim text
    jurisdiction: text("jurisdiction").notNull(), // US_FTC_FDA | EU_EFSA_DSA
    verdict: text("verdict").notNull(), // safe | risky | banned
    rationale: text("rationale"),
    evidenceSource: text("evidence_source"),
    brandRunsThisClaim: boolean("brand_runs_this_claim").notNull().default(false),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("compliance_brand_subject_juris_uidx").on(t.brandId, t.subject, t.jurisdiction),
    index("compliance_brand_idx").on(t.brandId),
  ]
);

// THE B3 — versioned Brand Intelligence object (the single grounding source).
export const brandIntelligence = pgTable(
  "brand_intelligence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"), // draft | approved
    json: jsonb("json").$type<Record<string, unknown>>().notNull().default({}), // the B3 object
    confidenceJson: jsonb("confidence_json").$type<Record<string, number>>().notNull().default({}),
    gapsJson: jsonb("gaps_json").$type<{ field: string; severity: string; reason: string }[]>().notNull().default([]),
    sourceRefsJson: jsonb("source_refs_json").$type<Record<string, unknown>>().notNull().default({}),
    approvedBy: uuid("approved_by").references(() => profiles.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("brand_intel_brand_version_uidx").on(t.brandId, t.version),
    index("brand_intel_brand_status_idx").on(t.brandId, t.status),
  ]
);

// =============================================
// IDEATION — Angle / Concept Generator (SOP Stage 1; first true B3 consumer).
// A batch row is the queue item (claim → generate via Claude → write angles → finalize).
// =============================================
export const angleBatches = pgTable(
  "angle_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    objective: text("objective"), // free-text campaign objective
    funnelStage: text("funnel_stage").notNull().default("TOF"), // TOF | MOF | BOF | any
    formats: jsonb("formats").$type<string[]>().notNull().default([]), // static | carousel | video | any
    count: integer("count").notNull().default(8),
    theme: text("theme"), // optional seed/theme
    seedAngleId: uuid("seed_angle_id"), // set for "regenerate-similar"
    paramsJson: jsonb("params_json").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("pending"), // pending | running | complete | failed
    groundingSource: text("grounding_source"), // b3 | flat | none
    b3Version: integer("b3_version"), // approved B3 version it grounded on (if b3)
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    errorMessage: text("error_message"),
    costCents: integer("cost_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("angle_batches_brand_status_idx").on(t.brandId, t.status),
    index("angle_batches_status_idx").on(t.status),
  ]
);

export const angles = pgTable(
  "angles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").notNull().references(() => angleBatches.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    format: text("format"), // static | carousel | video
    funnelStage: text("funnel_stage"),
    bigIdea: text("big_idea"),
    hook: text("hook"),
    emotionalDriver: text("emotional_driver"),
    targetPersona: text("target_persona"),
    proofMechanism: text("proof_mechanism"),
    complianceFlag: text("compliance_flag").notNull().default("safe"), // safe | risky | banned
    ruleRef: text("rule_ref"), // which compliance rule/phrase it touches
    sourceInspiration: text("source_inspiration"), // which winner/insight it draws on
    differentiationNote: text("differentiation_note"),
    score: numeric("score", { precision: 4, scale: 2 }), // relevance × novelty × brand-fit
    status: text("status").notNull().default("draft"), // draft | shortlisted | approved | sent_to_brief
    briefId: uuid("brief_id"), // handoff linkage to the (future) Brief Generator
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("angles_brand_status_idx").on(t.brandId, t.status),
    index("angles_batch_idx").on(t.batchId),
  ]
);

// =============================================
// BRIEF GENERATOR (SOP Stage 2 / A3) — an approved angle → a production-ready brief.
// A `briefs` row IS its own queue item (one brief per angle), claimed + finalized directly.
// =============================================
export const briefs = pgTable(
  "briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    angleId: uuid("angle_id").references(() => angles.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    format: text("format").notNull().default("static"), // static | carousel | video
    funnelStage: text("funnel_stage"),
    status: text("status").notNull().default("pending"), // pending | running | complete | failed | approved
    groundingSource: text("grounding_source"), // b3 | flat | none
    b3Version: integer("b3_version"),
    briefJson: jsonb("brief_json").$type<Record<string, unknown>>(), // video {hook_frame,script,scene_list,...} | static {frames,format_intent}
    referenceRef: jsonb("reference_ref").$type<{ kind: string; id: string; storageKey?: string | null } | null>(), // recreate-this-winner
    complianceNotesJson: jsonb("compliance_notes_json").$type<{ flag: string; ruleRef?: string | null; notes: string[] }>().notNull().default({ flag: "safe", notes: [] }),
    depth: text("depth").notNull().default("standard"), // concise | standard | detailed
    notes: text("notes"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    errorMessage: text("error_message"),
    costCents: integer("cost_cents").notNull().default(0),
    sentToProduction: text("sent_to_production"), // null | "static" | "video" (linkage marker)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("briefs_brand_status_idx").on(t.brandId, t.status),
    index("briefs_angle_idx").on(t.angleId),
    index("briefs_status_idx").on(t.status),
  ]
);

// =============================================
// AD COPY GENERATOR (SOP Stage 2 / A5) — angle/brief → N launch-ready copy variants.
// Batch = queue item (fans out to N variants), mirroring the Ideation batch→items shape.
// =============================================
export const adCopyBatches = pgTable(
  "ad_copy_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    angleId: uuid("angle_id").references(() => angles.id, { onDelete: "set null" }),
    briefId: uuid("brief_id").references(() => briefs.id, { onDelete: "set null" }),
    placement: text("placement").notNull().default("feed"), // feed | reels | story
    variantCount: integer("variant_count").notNull().default(3),
    funnelStage: text("funnel_stage"),
    status: text("status").notNull().default("pending"), // pending | running | complete | failed
    groundingSource: text("grounding_source"),
    b3Version: integer("b3_version"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    errorMessage: text("error_message"),
    costCents: integer("cost_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("ad_copy_batches_brand_status_idx").on(t.brandId, t.status),
    index("ad_copy_batches_status_idx").on(t.status),
  ]
);

export const adCopy = pgTable(
  "ad_copy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").notNull().references(() => adCopyBatches.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    angleId: uuid("angle_id").references(() => angles.id, { onDelete: "set null" }),
    briefId: uuid("brief_id").references(() => briefs.id, { onDelete: "set null" }),
    placement: text("placement"),
    primaryText: text("primary_text"),
    headline: text("headline"),
    cta: text("cta"),
    variantIndex: integer("variant_index").notNull().default(1),
    complianceFlag: text("compliance_flag").notNull().default("safe"), // safe | risky | banned
    ruleRef: text("rule_ref"),
    status: text("status").notNull().default("draft"), // draft | approved
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ad_copy_brand_status_idx").on(t.brandId, t.status),
    index("ad_copy_batch_idx").on(t.batchId),
  ]
);

// =============================================
// COMPLIANCE + QA GATE (SOP Stage 4 — THE MOAT). One review row per creative gated:
// AI scores a 6-criterion scorecard (Claude claim-safety + Gemini Vision) → pass/fail,
// human can override. The row IS the queue item (claim → score → guarded finalize → sweep).
// =============================================
export const gateReviews = pgTable(
  "gate_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    sourceSystem: text("source_system").notNull().default("static"), // static | video | external
    sourceId: uuid("source_id"), // the generation row gated (null for ad-hoc/external)
    assetPath: text("asset_path"), // storage key OR external https url of the image/poster
    copyText: text("copy_text"), // the on-feed / on-image copy claim-checked
    status: text("status").notNull().default("pending"), // pending | running | complete | failed
    overallPass: boolean("overall_pass"),
    criteriaJson: jsonb("criteria_json").$type<{ key: string; label: string; score: number; pass: boolean; note: string }[]>().notNull().default([]),
    complianceInherited: jsonb("compliance_inherited").$type<{ flag: string; ruleRef?: string | null; notes: string[] }>(),
    reviewer: text("reviewer").notNull().default("ai"), // ai | human
    overridden: boolean("overridden").notNull().default(false),
    groundingSource: text("grounding_source"),
    b3Version: integer("b3_version"),
    notes: text("notes"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    errorMessage: text("error_message"),
    costCents: integer("cost_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("gate_reviews_brand_status_idx").on(t.brandId, t.status),
    index("gate_reviews_source_idx").on(t.sourceId),
    index("gate_reviews_status_idx").on(t.status),
  ]
);
