ALTER TABLE "collections" ADD COLUMN "studio_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "studio_receipts" jsonb DEFAULT '[]'::jsonb NOT NULL;