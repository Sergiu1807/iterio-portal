CREATE TABLE "gate_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"source_system" text DEFAULT 'static' NOT NULL,
	"source_id" uuid,
	"asset_path" text,
	"copy_text" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"overall_pass" boolean,
	"criteria_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"compliance_inherited" jsonb,
	"reviewer" text DEFAULT 'ai' NOT NULL,
	"overridden" boolean DEFAULT false NOT NULL,
	"grounding_source" text,
	"b3_version" integer,
	"notes" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error_message" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gate_reviews" ADD CONSTRAINT "gate_reviews_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gate_reviews_brand_status_idx" ON "gate_reviews" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "gate_reviews_source_idx" ON "gate_reviews" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "gate_reviews_status_idx" ON "gate_reviews" USING btree ("status");