import type { CollectionKind } from "../collections";
import type { BooleanOperation, Contour, Matrix, Point, Segment } from "../vector/types";

export interface FoundryMetrics {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  capHeight: number;
  xHeight: number;
}

export interface GlyphMetrics {
  advanceWidth: number;
  leftBearing: number;
  rightBearing: number;
}

export interface Glyph {
  key: string;
  contours: Contour[];
  metrics: GlyphMetrics;
}

export interface GlyphFoundryState {
  id: string;
  kind: CollectionKind;
  revision: number;
  metrics: FoundryMetrics;
  glyphs: Record<string, Glyph>;
}

type ContourTarget = { key: string; contour: number };
type GlyphTarget = { key: string };

export type FoundryCommand =
  | ({ type: "createGlyph"; contours?: Contour[]; metrics?: GlyphMetrics } & GlyphTarget)
  | ({ type: "deleteGlyph" } & GlyphTarget)
  | ({ type: "replaceContours"; contours: Contour[] } & GlyphTarget)
  | ({ type: "appendContour"; contour: Contour } & GlyphTarget)
  | ({ type: "deleteContour" } & ContourTarget)
  | ({ type: "appendSegment"; segment: Segment } & ContourTarget)
  | ({ type: "closeContour" } & ContourTarget)
  | ({ type: "moveAnchor"; anchor: number; to: Point; moveHandles?: boolean } & ContourTarget)
  | ({ type: "moveHandle"; segment: number; handle: "control" | "control1" | "control2"; to: Point } & ContourTarget)
  | ({ type: "splitSegment"; segment: number; t: number } & ContourTarget)
  | ({ type: "transformContours"; indices?: number[]; matrix: Matrix } & GlyphTarget)
  | ({ type: "applyBoolean"; operation: BooleanOperation; subject: number[]; clip: number[] } & GlyphTarget)
  | ({ type: "setGlyphMetrics"; metrics: GlyphMetrics } & GlyphTarget)
  | { type: "setFoundryMetrics"; metrics: FoundryMetrics };

export interface CommandAttribution {
  id: string;
  actor: { kind: "human" | "agent"; id: string };
  /** ISO 8601 UTC timestamp supplied by the caller for deterministic replay. */
  timestamp: string;
}

export interface CommandEnvelope extends CommandAttribution {
  command: FoundryCommand;
  expectedRevision?: number;
}
