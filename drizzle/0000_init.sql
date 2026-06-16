CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "api_keys_key_name_unique" UNIQUE("key_name")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"website" text,
	"category" text,
	"primary_market" text,
	"currency" text,
	"tagline" text,
	"vibe" text,
	"brand_color" text DEFAULT '#5A7A64' NOT NULL,
	"palette" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fonts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cluster" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"onboarding_source" text,
	"enabled_systems" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"storage_prefix" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "competitor_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"scrape_job_id" uuid,
	"ad_archive_id" text NOT NULL,
	"ad_group_id" text,
	"collation_id" text,
	"competitor_page_id" text,
	"brand_page_name" text,
	"dedup_count" integer DEFAULT 1 NOT NULL,
	"snapshot_id" text,
	"snapshot_date" timestamp with time zone,
	"ad_start_date" timestamp with time zone,
	"meta_sort_rank" integer,
	"is_dco" boolean DEFAULT false NOT NULL,
	"media_type" text,
	"primary_thumbnail" text,
	"full_media_asset" text,
	"display_primary_text" text,
	"headline_title" text,
	"cta_button_type" text,
	"destination_url" text,
	"display_domain" text,
	"ad_library_url" text,
	"publisher_platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"creative_angle" text,
	"ad_description" text,
	"target_persona" text,
	"core_motivation" text,
	"proof_mechanism" text,
	"visual_hook" text,
	"spoken_hook" text,
	"outro_offer" text,
	"full_transcript" text,
	"gemini_description" text,
	"ai_analysis_status" text DEFAULT 'queued' NOT NULL,
	"ai_error_message" text,
	"ai_attempts" integer DEFAULT 0 NOT NULL,
	"ai_last_analyzed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"instagram_handle" text,
	"tiktok_handle" text,
	"meta_page_id" text,
	"meta_search_terms" text,
	"type" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_scraped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"title" text NOT NULL,
	"section_type" text,
	"content" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"demographics" text,
	"psychographics" text,
	"pain_points" text,
	"desires" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"key_benefits" text,
	"price" text,
	"product_url" text,
	"image_url" text,
	"is_hero" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"role" text DEFAULT 'member' NOT NULL,
	"display_name" text,
	"last_brand_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"competitor_id" uuid,
	"system_key" text DEFAULT 'competitor-research' NOT NULL,
	"platform" text DEFAULT 'meta' NOT NULL,
	"mode" text DEFAULT 'page_id' NOT NULL,
	"query" text NOT NULL,
	"country" text DEFAULT 'ALL' NOT NULL,
	"requested_count" integer DEFAULT 20 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"apify_run_id" text,
	"apify_dataset_id" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"system_key" text,
	"brand_id" uuid,
	"key_name" text,
	"model" text,
	"units" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"text" text NOT NULL,
	"category" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD CONSTRAINT "competitor_ads_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD CONSTRAINT "competitor_ads_scrape_job_id_scrape_jobs_id_fk" FOREIGN KEY ("scrape_job_id") REFERENCES "public"."scrape_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_sections" ADD CONSTRAINT "intelligence_sections_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usps" ADD CONSTRAINT "usps_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brands_owner_idx" ON "brands" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_ads_brand_archive_uidx" ON "competitor_ads" USING btree ("brand_id","ad_archive_id");--> statement-breakpoint
CREATE INDEX "competitor_ads_brand_idx" ON "competitor_ads" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "competitor_ads_analysis_status_idx" ON "competitor_ads" USING btree ("ai_analysis_status");--> statement-breakpoint
CREATE INDEX "competitors_brand_idx" ON "competitors" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "intel_brand_idx" ON "intelligence_sections" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "personas_brand_idx" ON "personas" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "products_brand_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "scrape_jobs_brand_idx" ON "scrape_jobs" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "scrape_jobs_status_idx" ON "scrape_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usage_provider_created_idx" ON "usage_events" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "usage_system_created_idx" ON "usage_events" USING btree ("system_key","created_at");--> statement-breakpoint
CREATE INDEX "usage_brand_created_idx" ON "usage_events" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "usps_brand_idx" ON "usps" USING btree ("brand_id");