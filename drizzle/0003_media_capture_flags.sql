ALTER TABLE "competitor_ads" ADD COLUMN "media_capture_failed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "media_capture_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_ads" ADD COLUMN "source_media_urls" jsonb;