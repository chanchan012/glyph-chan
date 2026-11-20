import { and, asc, eq } from "drizzle-orm";
import { connectDatabase } from "../db/client";
import { collections, glyphs } from "../db/schema";
import type { StudioSource } from "../lib/foundry/studio-source";

export async function loadStudio(ownerId: string, id: string): Promise<StudioSource | null> {
  const rows = await connectDatabase().select({ collection: collections, glyph: glyphs })
    .from(collections)
    .leftJoin(glyphs, eq(glyphs.collectionId, collections.id))
    .where(and(eq(collections.id, id), eq(collections.ownerId, ownerId)))
    .orderBy(asc(glyphs.key));
  const collection = rows[0]?.collection;
  if (!collection) return null;
  const { name, kind, unitsPerEm, ascender, descender, capHeight, xHeight } = collection;
  return {
    id, name, ownerId, kind,
    metrics: { unitsPerEm, ascender, descender, capHeight, xHeight },
    glyphs: rows.flatMap(({ glyph }) => glyph ? [{
      key: glyph.key, paths: glyph.paths,
      metrics: { advanceWidth: glyph.advanceWidth, leftBearing: glyph.leftBearing, rightBearing: glyph.rightBearing },
    }] : []),
  };
}
