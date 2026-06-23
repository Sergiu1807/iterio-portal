CREATE TABLE "angle_bank_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"representative_ad_id" uuid,
	"advertiser" text,
	"first_seen" timestamp with time zone,
	"last_seen_active" timestamp with time zone,
	"still_active" boolean DEFAULT false NOT NULL,
	"format" text,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"offer" text,
	"angle" text,
	"hook" text,
	"mechanism" text,
	"awareness_level" text,
	"emotional_driver" text,
	"secondary_drivers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"beat_structure" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visual_notes" text,
	"native_score" numeric(4, 3),
	"compliance_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"winner_score" integer DEFAULT 0 NOT NULL,
	"winner_tier" text,
	"signals" jsonb,
	"confidence" text DEFAULT 'low' NOT NULL,
	"status" text DEFAULT 'raw' NOT NULL,
	"used_in_generations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"competitor_id" uuid,
	"concept_key" text NOT NULL,
	"cluster_method" text NOT NULL,
	"advertiser" text,
	"representative_ad_id" uuid,
	"active_variant_count" integer DEFAULT 0 NOT NULL,
	"total_variant_count" integer DEFAULT 0 NOT NULL,
	"distinct_formats" integer DEFAULT 0 NOT NULL,
	"formats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_seen" timestamp with time zone,
	"last_seen_active" timestamp with time zone,
	"active_days" integer DEFAULT 0 NOT NULL,
	"peak_active_days" integer DEFAULT 0 NOT NULL,
	"still_active" boolean DEFAULT false NOT NULL,
	"resurrected" boolean DEFAULT false NOT NULL,
	"eu_total_reach" integer,
	"eu_reach_per_day" numeric(12, 2),
	"winner_score" integer DEFAULT 0 NOT NULL,
	"winner_tier" text,
	"confidence" text DEFAULT 'low' NOT NULL,
	"count_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_scored_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swipe_library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"angle_bank_entry_id" uuid,
	"concept_id" uuid,
	"niche" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"snapshot" jsonb,
	"saved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "awareness_level" text;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "emotional_driver" text;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "secondary_drivers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "beat_structure" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "visual_notes" text;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "native_score" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "compliance_flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "still_active" boolean;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "first_seen_active" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "last_seen_active" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "active_days" integer;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "resurrected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "concept_id" uuid;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "niche" text;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD COLUMN "niche" text;--> statement-breakpoint
ALTER TABLE "angle_bank_entries" ADD CONSTRAINT "angle_bank_entries_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "angle_bank_entries" ADD CONSTRAINT "angle_bank_entries_concept_id_concept_clusters_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concept_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "angle_bank_entries" ADD CONSTRAINT "angle_bank_entries_representative_ad_id_competitor_ads_id_fk" FOREIGN KEY ("representative_ad_id") REFERENCES "public"."competitor_ads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_clusters" ADD CONSTRAINT "concept_clusters_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_clusters" ADD CONSTRAINT "concept_clusters_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swipe_library" ADD CONSTRAINT "swipe_library_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swipe_library" ADD CONSTRAINT "swipe_library_angle_bank_entry_id_angle_bank_entries_id_fk" FOREIGN KEY ("angle_bank_entry_id") REFERENCES "public"."angle_bank_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swipe_library" ADD CONSTRAINT "swipe_library_concept_id_concept_clusters_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concept_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swipe_library" ADD CONSTRAINT "swipe_library_saved_by_profiles_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "angle_bank_concept_uidx" ON "angle_bank_entries" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "angle_bank_brand_idx" ON "angle_bank_entries" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "angle_bank_status_idx" ON "angle_bank_entries" USING btree ("brand_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_clusters_brand_key_uidx" ON "concept_clusters" USING btree ("brand_id","concept_key");--> statement-breakpoint
CREATE INDEX "concept_clusters_brand_idx" ON "concept_clusters" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "concept_clusters_score_idx" ON "concept_clusters" USING btree ("brand_id","winner_score");--> statement-breakpoint
CREATE INDEX "swipe_brand_idx" ON "swipe_library" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "swipe_niche_idx" ON "swipe_library" USING btree ("niche");--> statement-breakpoint
CREATE INDEX "competitor_ads_concept_idx" ON "competitor_ads" USING btree ("concept_id");--> statement-breakpoint
UPDATE "competitor_ads" SET "first_seen_active" = COALESCE("ad_start_date", "snapshot_date") WHERE "first_seen_active" IS NULL;--> statement-breakpoint
UPDATE "competitor_ads" SET "last_seen_active" = "snapshot_date" WHERE "last_seen_active" IS NULL;--> statement-breakpoint
UPDATE "competitor_ads" SET "still_active" = true WHERE "still_active" IS NULL;