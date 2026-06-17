CREATE TABLE "video_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_path" text NOT NULL,
	"analysis_json" text,
	"tags" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"product_id" uuid,
	"character_id" uuid,
	"scene_id" uuid,
	"video_type" text DEFAULT 'ugc' NOT NULL,
	"aroll_style" text,
	"mode" text DEFAULT 'ugc' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"kie_model" text,
	"kie_job_id" text,
	"duration" integer DEFAULT 10 NOT NULL,
	"aspect_ratio" text DEFAULT '9:16' NOT NULL,
	"resolution" text DEFAULT '720p' NOT NULL,
	"output_format" text DEFAULT 'mp4' NOT NULL,
	"script" text,
	"crafter_prompt" text,
	"studio_flow_prompt" text,
	"final_prompt" text,
	"video_path" text,
	"thumbnail_path" text,
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
CREATE TABLE "video_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_path" text NOT NULL,
	"analysis_json" text,
	"tags" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_characters" ADD CONSTRAINT "video_characters_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generations" ADD CONSTRAINT "video_generations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generations" ADD CONSTRAINT "video_generations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generations" ADD CONSTRAINT "video_generations_character_id_video_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."video_characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generations" ADD CONSTRAINT "video_generations_scene_id_video_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."video_scenes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_char_brand_idx" ON "video_characters" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "video_gen_brand_status_idx" ON "video_generations" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "video_gen_batch_idx" ON "video_generations" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "video_scene_brand_idx" ON "video_scenes" USING btree ("brand_id");