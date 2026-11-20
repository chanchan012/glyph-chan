import { pathBounds, type Bounds } from "../vector/bezier";
import type { Glyph, GlyphFoundryState, KerningPair } from "./types";

export interface TextGlyph {
  key: string;
  glyph?: Glyph;
  /** Outline offset from the line origin. */
  x: number;
  advanceWidth: number;
  adjustment: number;
  missing: boolean;
}

export interface TextLine {
  glyphs: TextGlyph[];
  advanceWidth: number;
  bounds: Bounds;
}

function pairKey(left: string, right: string) {
  return JSON.stringify([left, right]);
}

export function layoutText(document: GlyphFoundryState, text: string, options: {
  kerning?: boolean; draftPair?: KerningPair;
} = {}): TextLine[] {
  const { unitsPerEm, ascender, descender, capHeight } = document.metrics;
  const pairs = new Map(document.kerning.map(pair => [pairKey(pair.left, pair.right), pair.adjustment]));
  const draft = options.draftPair;
  if (draft) pairs.set(pairKey(draft.left, draft.right), draft.adjustment);

  const outlineBounds = new Map<string, Bounds | null>();
  return text.normalize("NFC").split(/\r\n?|\n/).map(line => {
    let advance = 0;
    let previous: string | undefined;
    const bounds: Bounds = { minX: 0, maxX: 0, minY: -ascender, maxY: -descender };
    const glyphs = Array.from(line, (key): TextGlyph => {
      const glyph = Object.hasOwn(document.glyphs, key) ? document.glyphs[key] : undefined;
      const space = /\p{Zs}/u.test(key);
      const missing = !glyph && !space;
      const adjustment = options.kerning !== false && previous !== undefined
        ? pairs.get(pairKey(previous, key)) ?? 0 : 0;
      advance += adjustment;
      if (glyph && !outlineBounds.has(key)) outlineBounds.set(key, pathBounds(glyph.contours));
      const outline = outlineBounds.get(key);
      const x = advance + (outline && glyph ? glyph.metrics.leftBearing - outline.minX : 0);
      const width = glyph?.metrics.advanceWidth ?? Math.round(unitsPerEm * (space ? .33 : .6));
      if (outline) {
        bounds.minX = Math.min(bounds.minX, x + outline.minX);
        bounds.maxX = Math.max(bounds.maxX, x + outline.maxX);
        bounds.minY = Math.min(bounds.minY, outline.minY);
        bounds.maxY = Math.max(bounds.maxY, outline.maxY);
      } else if (missing) {
        bounds.minY = Math.min(bounds.minY, -capHeight);
      }
      bounds.minX = Math.min(bounds.minX, advance);
      advance += width;
      bounds.maxX = Math.max(bounds.maxX, advance);
      previous = key;
      return { key, glyph, x, advanceWidth: width, adjustment, missing };
    });
    return { glyphs, advanceWidth: advance, bounds };
  });
}
