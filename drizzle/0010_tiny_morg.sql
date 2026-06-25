CREATE TABLE "angle_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"product_id" uuid,
	"objective" text,
	"funnel_stage" text DEFAULT 'TOF' NOT NULL,
	"formats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"count" integer DEFAULT 8 NOT NULL,
	"theme" text,
	"seed_angle_id" uuid,
	"params_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
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
CREATE TABLE "angles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"title" text NOT NULL,
	"format" text,
	"funnel_stage" text,
	"big_idea" text,
	"hook" text,
	"emotional_driver" text,
	"target_persona" text,
	"proof_mechanism" text,
	"compliance_flag" text DEFAULT 'safe' NOT NULL,
	"rule_ref" text,
	"source_inspiration" text,
	"differentiation_note" text,
	"score" numeric(4, 2),
	"status" text DEFAULT 'draft' NOT NULL,
	"brief_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "angle_batches" ADD CONSTRAINT "angle_batches_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "angle_batches" ADD CONSTRAINT "angle_batches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "angles" ADD CONSTRAINT "angles_batch_id_angle_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."angle_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "angles" ADD CONSTRAINT "angles_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "angle_batches_brand_status_idx" ON "angle_batches" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "angle_batches_status_idx" ON "angle_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "angles_brand_status_idx" ON "angles" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "angles_batch_idx" ON "angles" USING btree ("batch_id");