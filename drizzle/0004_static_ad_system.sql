CREATE TABLE "static_ad_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"agent1_prompt" text NOT NULL,
	"agent2_prompt" text NOT NULL,
	"brief_agent1_prompt" text,
	"brief_agent2_prompt" text,
	"brand_logo_path" text,
	"status" text DEFAULT 'placeholder' NOT NULL,
	"is_placeholder" boolean DEFAULT true NOT NULL,
	"build_error" text,
	"built_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "static_ad_config_brand_id_unique" UNIQUE("brand_id")
);
--> statement-breakpoint
CREATE TABLE "static_ad_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"product_id" uuid,
	"mode" text DEFAULT 'custom' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"kie_model" text,
	"kie_job_id" text,
	"aspect_ratio" text DEFAULT '1:1' NOT NULL,
	"resolution" text DEFAULT '2K' NOT NULL,
	"output_format" text DEFAULT 'png' NOT NULL,
	"final_prompt" text,
	"analysis_json" text,
	"reference_path" text,
	"ad_copy" text,
	"image_path" text,
	"batch_id" uuid,
	"batch_index" integer DEFAULT 1 NOT NULL,
	"batch_size" integer DEFAULT 1 NOT NULL,
	"source_generation_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "static_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text,
	"image_path" text NOT NULL,
	"tags" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "static_ad_config" ADD CONSTRAINT "static_ad_config_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "static_ad_generations" ADD CONSTRAINT "static_ad_generations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "static_ad_generations" ADD CONSTRAINT "static_ad_generations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "static_references" ADD CONSTRAINT "static_references_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "static_gen_brand_status_idx" ON "static_ad_generations" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "static_gen_batch_idx" ON "static_ad_generations" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "static_ref_brand_idx" ON "static_references" USING btree ("brand_id");