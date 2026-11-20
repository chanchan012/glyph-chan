import { sql } from "drizzle-orm";
import { pgTable, pgEnum, uuid, text, integer, timestamp, jsonb, unique, check, index } from "drizzle-orm/pg-core";

export const collectionKind = pgEnum("collection_kind", ["typeface", "icon_set"]);
export const collections = pgTable("collections", {
  id: uuid().primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  name: text().notNull(),
  kind: collectionKind().notNull(),
  unitsPerEm: integer("units_per_em").notNull().default(1000),
  ascender: integer().notNull().default(800),
  descender: integer().notNull().default(-200),
  capHeight: integer("cap_height").notNull().default(700),
  xHeight: integer("x_height").notNull().default(500),
  thumbnail: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("collections_owner_idx").on(t.ownerId), check("positive_em", sql`${t.unitsPerEm} > 0`)]);

export const glyphs = pgTable("glyphs", {
  id: uuid().primaryKey().defaultRandom(),
  collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "cascade" }).notNull(),
  key: text().notNull(),
  paths: jsonb().$type<string[]>().notNull().default([]),
  advanceWidth: integer("advance_width").notNull().default(600),
  leftBearing: integer("left_bearing").notNull().default(50),
  rightBearing: integer("right_bearing").notNull().default(50),
  revision: integer().notNull().default(0),
}, t => [unique().on(t.collectionId, t.key)]);

export const kerningPairs = pgTable("kerning_pairs", {
  collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "cascade" }).notNull(),
  leftKey: text("left_key").notNull(),
  rightKey: text("right_key").notNull(),
  adjustment: integer().notNull(),
}, t => [unique().on(t.collectionId, t.leftKey, t.rightKey)]);
