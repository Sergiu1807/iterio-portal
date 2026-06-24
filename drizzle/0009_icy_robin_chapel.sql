CREATE TABLE "brand_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"type" text NOT NULL,
	"storage_key" text NOT NULL,
	"source_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_intelligence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gaps_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_refs_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"type" text NOT NULL,
	"url" text,
	"handle" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"verdict" text NOT NULL,
	"rationale" text,
	"evidence_source" text,
	"brand_runs_this_claim" boolean DEFAULT false NOT NULL,
	"confidence" numeric(4, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"source_id" uuid,
	"job_id" uuid,
	"schema_type" text NOT NULL,
	"json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" numeric(4, 3),
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"job_id" uuid,
	"kind" text NOT NULL,
	"storage_key" text,
	"external_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"source_id" uuid,
	"module" text NOT NULL,
	"type" text DEFAULT 'fetch' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text,
	"apify_run_id" text,
	"apify_dataset_id" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_source_id_brand_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."brand_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_intelligence" ADD CONSTRAINT "brand_intelligence_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_intelligence" ADD CONSTRAINT "brand_intelligence_approved_by_profiles_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_sources" ADD CONSTRAINT "brand_sources_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_source_id_brand_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."brand_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_job_id_research_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."research_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_artifacts" ADD CONSTRAINT "raw_artifacts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_artifacts" ADD CONSTRAINT "raw_artifacts_job_id_research_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."research_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_source_id_brand_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."brand_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_assets_brand_key_uidx" ON "brand_assets" USING btree ("brand_id","storage_key");--> statement-breakpoint
CREATE INDEX "brand_assets_brand_type_idx" ON "brand_assets" USING btree ("brand_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_intel_brand_version_uidx" ON "brand_intelligence" USING btree ("brand_id","version");--> statement-breakpoint
CREATE INDEX "brand_intel_brand_status_idx" ON "brand_intelligence" USING btree ("brand_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_sources_brand_type_url_uidx" ON "brand_sources" USING btree ("brand_id","type","url");--> statement-breakpoint
CREATE INDEX "brand_sources_brand_idx" ON "brand_sources" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_brand_subject_juris_uidx" ON "compliance_rules" USING btree ("brand_id","subject","jurisdiction");--> statement-breakpoint
CREATE INDEX "compliance_brand_idx" ON "compliance_rules" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extractions_source_schema_uidx" ON "extractions" USING btree ("source_id","schema_type");--> statement-breakpoint
CREATE INDEX "extractions_brand_schema_idx" ON "extractions" USING btree ("brand_id","schema_type");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_artifacts_job_external_uidx" ON "raw_artifacts" USING btree ("job_id","kind","external_id");--> statement-breakpoint
CREATE INDEX "raw_artifacts_brand_idx" ON "raw_artifacts" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "research_jobs_brand_status_idx" ON "research_jobs" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "research_jobs_source_idx" ON "research_jobs" USING btree ("source_id");