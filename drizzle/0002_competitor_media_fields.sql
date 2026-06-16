ALTER TABLE "competitor_ads" ADD COLUMN "video_path" text;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "media_cards" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "platforms_display" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "meta_library_url" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "country" text DEFAULT 'ALL' NOT NULL;