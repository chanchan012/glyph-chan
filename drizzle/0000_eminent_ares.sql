CREATE TYPE "public"."collection_kind" AS ENUM('typeface', 'icon_set');--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "collection_kind" NOT NULL,
	"units_per_em" integer DEFAULT 1000 NOT NULL,
	"ascender" integer DEFAULT 800 NOT NULL,
	"descender" integer DEFAULT -200 NOT NULL,
	"cap_height" integer DEFAULT 700 NOT NULL,
	"x_height" integer DEFAULT 500 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positive_em" CHECK ("collections"."units_per_em" > 0)
);
--> statement-breakpoint
CREATE TABLE "glyphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"key" text NOT NULL,
	"paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"advance_width" integer DEFAULT 600 NOT NULL,
	"left_bearing" integer DEFAULT 50 NOT NULL,
	"right_bearing" integer DEFAULT 50 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "glyphs_collection_id_key_unique" UNIQUE("collection_id","key")
);
--> statement-breakpoint
CREATE TABLE "kerning_pairs" (
	"collection_id" uuid NOT NULL,
	"left_key" text NOT NULL,
	"right_key" text NOT NULL,
	"adjustment" integer NOT NULL,
	CONSTRAINT "kerning_pairs_collection_id_left_key_right_key_unique" UNIQUE("collection_id","left_key","right_key")
);
--> statement-breakpoint
ALTER TABLE "glyphs" ADD CONSTRAINT "glyphs_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kerning_pairs" ADD CONSTRAINT "kerning_pairs_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collections_owner_idx" ON "collections" USING btree ("owner_id");