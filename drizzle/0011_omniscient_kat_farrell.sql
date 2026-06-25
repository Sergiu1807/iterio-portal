CREATE TABLE "ad_copy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"angle_id" uuid,
	"brief_id" uuid,
	"placement" text,
	"primary_text" text,
	"headline" text,
	"cta" text,
	"variant_index" integer DEFAULT 1 NOT NULL,
	"compliance_flag" text DEFAULT 'safe' NOT NULL,
	"rule_ref" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_copy_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"angle_id" uuid,
	"brief_id" uuid,
	"placement" text DEFAULT 'feed' NOT NULL,
	"variant_count" integer DEFAULT 3 NOT NULL,
	"funnel_stage" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"grounding_source" text,
	"b3_version" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error_message" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"angle_id" uuid,
	"product_id" uuid,
	"format" text DEFAULT 'static' NOT NULL,
	"funnel_stage" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"grounding_source" text,
	"b3_version" integer,
	"brief_json" jsonb,
	"reference_ref" jsonb,
	"compliance_notes_json" jsonb DEFAULT '{"flag":"safe","notes":[]}'::jsonb NOT NULL,
	"depth" text DEFAULT 'standard' NOT NULL,
	"notes" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error_message" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"sent_to_production" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ad_copy" ADD CONSTRAINT "ad_copy_batch_id_ad_copy_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ad_copy_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_copy" ADD CONSTRAINT "ad_copy_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_copy" ADD CONSTRAINT "ad_copy_angle_id_angles_id_fk" FOREIGN KEY ("angle_id") REFERENCES "public"."angles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_copy" ADD CONSTRAINT "ad_copy_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_copy_batches" ADD CONSTRAINT "ad_copy_batches_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_copy_batches" ADD CONSTRAINT "ad_copy_batches_angle_id_angles_id_fk" FOREIGN KEY ("angle_id") REFERENCES "public"."angles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_copy_batches" ADD CONSTRAINT "ad_copy_batches_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_angle_id_angles_id_fk" FOREIGN KEY ("angle_id") REFERENCES "public"."angles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_copy_brand_status_idx" ON "ad_copy" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "ad_copy_batch_idx" ON "ad_copy" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ad_copy_batches_brand_status_idx" ON "ad_copy_batches" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "ad_copy_batches_status_idx" ON "ad_copy_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "briefs_brand_status_idx" ON "briefs" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "briefs_angle_idx" ON "briefs" USING btree ("angle_id");--> statement-breakpoint
CREATE INDEX "briefs_status_idx" ON "briefs" USING btree ("status");