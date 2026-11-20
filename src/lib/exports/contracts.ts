import { z } from "zod";
import type { StudioSource } from "../foundry/studio-source";
import type { GlyphFoundryState } from "../foundry/types";
import { serializePath } from "../vector/svg";

export const exportFormats = ["woff2", "ttf", "svg", "react", "specimen"] as const;
export type ExportFormat = (typeof exportFormats)[number];

const label = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\p{Cc}\p{Cs}]+$/u);
const signed16 = z.number().int().min(-32768).max(32767);
const glyphKey = z.string().min(1).max(80).regex(/^[^\p{Cc}\p{Cs}]+$/u);

export const exportRequest = z.object({
  collectionId: z.uuid().optional(),
  name: label(80),
  kind: z.enum(["typeface", "icon_set"]),
  format: z.enum(exportFormats),
  text: z.string().max(180).optional(),
  metrics: z.object({
    unitsPerEm: z.number().int().min(16).max(16384),
    ascender: z.number().int().min(1).max(32767),
    descender: z.number().int().min(-32768).max(0),
    capHeight: z.number().int().min(1).max(32767),
    xHeight: z.number().int().min(1).max(32767),
  }).strict(),
  glyphs: z.array(z.object({
    key: glyphKey,
    paths: z.array(z.string().max(150_000)).max(256),
    metrics: z.object({
      advanceWidth: z.number().int().min(0).max(65535),
      leftBearing: signed16,
      rightBearing: signed16,
    }).strict(),
  }).strict()).max(1024),
  kerning: z.array(z.object({ left: glyphKey, right: glyphKey, adjustment: signed16 }).strict()).max(4096),
}).strict();

export type ExportRequest = z.infer<typeof exportRequest>;
export interface ExportArtifact {
  filename: string;
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export function toExportRequest(source: Pick<StudioSource, "id" | "name" | "ownerId">, document: GlyphFoundryState, format: ExportFormat, text?: string): ExportRequest {
  return {
    collectionId: source.ownerId === "guest" ? undefined : source.id,
    name: source.name,
    kind: document.kind,
    format,
    text,
    metrics: document.metrics,
    glyphs: Object.values(document.glyphs).map(({ key, contours, metrics }) => ({
      key, paths: contours.map(contour => serializePath([contour])), metrics,
    })),
    kerning: document.kerning,
  };
}

export class ExportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportInputError";
  }
}

export function exportSlug(value: string) {
  return value.normalize("NFKD").replace(/\p{Mark}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "glyph";
}
