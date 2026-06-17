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
    isActive: boolean("is_active").notNull().default(true),
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
    // pending | running | ingesting | analyzing | complete | error
    status: text("status").notNull().default("pending"),
    apifyRunId: text("apify_run_id"),
    apifyDatasetId: text("apify_dataset_id"),
    stats: jsonb("stats").$type<{ adsFound?: number; adsNew?: number; adsAnalyzed?: number }>().notNull().default({}),
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
    mediaCards: jsonb("media_cards").$type<string[]>().notNull().default([]), // carousel image paths
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
