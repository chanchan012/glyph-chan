import { z } from "zod";
import type { FoundryMetrics, GlyphFoundryState, GlyphMetrics, KerningPair } from "./types";
import { serializePath } from "../vector/svg";

export interface StudioSnapshot {
  metrics: FoundryMetrics;
  glyphs: { key: string; paths: string[]; metrics: GlyphMetrics }[];
  kerning: KerningPair[];
}

export interface StudioActor {
  kind: "human" | "agent";
  id: string;
  label: string;
}

export interface StudioReceipt {
  requestId: string;
  revision: number;
  actor: StudioActor;
  at: string;
}

export interface StudioHead {
  syncRevision: number;
  receipts: StudioReceipt[];
}

const key = z.string().min(1).max(80).regex(/^[^\p{Cc}\p{Cs}]+$/u);
const signed = z.number().int().min(-32768).max(32767);
const pos = z.number().int().min(1).max(32767);
export const revisionSchema = z.number().int().min(0).max(2_147_483_646);
export const clientIdSchema = z.uuid();
export const snapshotSchema: z.ZodType<StudioSnapshot> = z.object({
  metrics: z.object({
    unitsPerEm: z.number().int().min(16).max(16384),
    ascender: pos, descender: z.number().int().min(-32768).max(0),
    capHeight: pos, xHeight: pos,
  }).strict(),
  glyphs: z.array(z.object({
    key,
    paths: z.array(z.string().max(500_000)).max(512),
    metrics: z.object({
      advanceWidth: z.number().int().min(0).max(65535), leftBearing: signed, rightBearing: signed,
    }).strict(),
  }).strict()).max(3072),
  kerning: z.array(z.object({ left: key, right: key, adjustment: signed }).strict()).max(12_288),
}).strict();

export const saveStudioSchema = z.object({
  requestId: z.uuid(),
  expectedRevision: revisionSchema,
  snapshot: snapshotSchema,
}).strict();
export type StudioSave = z.infer<typeof saveStudioSchema>;

const index = z.number().int().min(0).max(31_999);
export const presenceAnchorSchema = z.object({ contour: index, index }).strict();
export const presenceInput = z.object({
  clientId: clientIdSchema,
  glyph: key.nullable(),
  anchor: presenceAnchorSchema.nullable(),
}).strict();
export type PresenceInput = z.infer<typeof presenceInput>;
export type StudioPresence = PresenceInput & { actor: StudioActor; expiresAt: number };
export type StudioLiveEvent = { type: "revision"; receipt: StudioReceipt }
  | { type: "presence"; entry: StudioPresence };

export function studioSnapshot(document: GlyphFoundryState): StudioSnapshot {
  return {
    metrics: document.metrics,
    glyphs: Object.keys(document.glyphs).sort().map(key => {
      const { contours, metrics } = document.glyphs[key];
      return { key, paths: contours.map(contour => serializePath([contour])), metrics };
    }),
    kerning: document.kerning,
  };
}
