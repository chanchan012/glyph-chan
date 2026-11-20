import { specimens } from "../specimens";
import { parsePath, serializePath } from "../vector/svg";
import { transformContour } from "../vector/types";
import { createFoundry, recordCommand } from "./document";
import type { FoundryCommand, FoundryMetrics, GlyphFoundryState, GlyphMetrics, KerningPair } from "./types";
import type { StudioReceipt, StudioSnapshot } from "./sync-contract";

export interface StudioSource {
  id: string;
  name: string;
  ownerId: string;
  kind: GlyphFoundryState["kind"];
  metrics: FoundryMetrics;
  glyphs: { key: string; paths: string[]; metrics: GlyphMetrics }[];
  kerning?: KerningPair[];
  syncRevision?: number;
  receipts?: StudioReceipt[];
}

export function snapshotDocument(source: StudioSource, snapshot: StudioSnapshot) {
  return studioDocument({ ...source, ...snapshot });
}

export function studioDocument(source: StudioSource) {
  let document = createFoundry(source.id, source.kind, source.metrics);
  function hydrate(id: string, command: FoundryCommand) {
    document = recordCommand(document, {
      id: "hydrate:" + id,
      actor: { kind: "human", id: source.ownerId },
      timestamp: "1970-01-01T00:00:00.000Z",
      command,
    }).state;
  }
  for (const glyph of source.glyphs) {
    hydrate(glyph.key, { type: "createGlyph", key: glyph.key, metrics: glyph.metrics, contours: glyph.paths.flatMap(parsePath) });
  }
  for (const { left, right, adjustment } of source.kerning ?? []) {
    hydrate(left + right, { type: "setKerningPair", left, right, adjustment });
  }
  return { ...document, revision: 0 };
}

const demoMetrics = { unitsPerEm: 1000, ascender: 780, descender: -220, capHeight: 685, xHeight: 525 };
const demoGlyphMetrics = { advanceWidth: 700, leftBearing: 60, rightBearing: 60 };
const proofGlyphs: StudioSource["glyphs"] = [
  { key: "A", paths: ["M28 0 L252 -685 H385 L609 0 H463 L414 -155 H221 L173 0 Z M259 -270 H378 L319 -471 Z"], metrics: { advanceWidth: 641, leftBearing: 28, rightBearing: 32 } },
  { key: "V", paths: ["M26 -685 H175 L323 -173 L469 -685 H615 L389 0 H252 Z"], metrics: { advanceWidth: 643, leftBearing: 26, rightBearing: 28 } },
  { key: "r", paths: ["M35 0 V-19 H98 V-485 H41 V-503 L225 -528 V-421 C243 -488 293 -532 349 -532 C401 -532 426 -505 426 -467 C426 -435 407 -414 378 -414 C349 -414 329 -432 326 -465 C322 -503 259 -468 231 -396 V-19 H301 V0 Z"], metrics: { advanceWidth: 453, leftBearing: 35, rightBearing: 27 } },
];

function specimenGlyph(specimen: (typeof specimens)[number], key: string) {
  const contours = parsePath(specimen.path).map(contour => transformContour(contour, [3.25, 0, 0, 3.25, -55, -650]));
  return { key, paths: [serializePath(contours)], metrics: demoGlyphMetrics };
}

export function guestStudio(id: string): StudioSource | null {
  const preset = id === "demo" || id === "forma" ? specimens[0]
    : id === "axial" ? specimens[1] : id === "orbit" ? specimens[3] : null;
  if (!preset) return null;
  const iconSet = preset === specimens[3];
  return {
    id,
    ownerId: "guest",
    name: preset.name,
    kind: iconSet ? "icon_set" : "typeface",
    metrics: demoMetrics,
    glyphs: iconSet ? [specimenGlyph(preset, "orbit")]
      : [...[preset, ...specimens.slice(0, 3).filter(specimen => specimen !== preset)]
        .map(specimen => specimenGlyph(specimen, specimen.char)), ...proofGlyphs],
    kerning: iconSet ? [] : [{ left: "A", right: "V", adjustment: -52 }],
  };
}

export function commandEnvelope(actorId: string, command: FoundryCommand, expectedRevision?: number) {
  return {
    id: crypto.randomUUID(),
    actor: { id: actorId, kind: "human" as const },
    timestamp: new Date().toISOString(),
    expectedRevision,
    command,
  };
}

export function studioDraftKey(source: StudioSource) {
  return "glyph:studio:v1:" + source.ownerId + ":" + source.id;
}

export function encodeStudioDraft(document: GlyphFoundryState) {
  return JSON.stringify({
    metrics: document.metrics,
    kerning: document.kerning,
    glyphs: Object.values(document.glyphs).map(({ key, metrics, contours }) => ({
      key, metrics, paths: contours.map(contour => serializePath([contour])),
    })),
  });
}

export function decodeStudioDraft(source: StudioSource, value: string) {
  if (value.length > 5_000_000) throw new RangeError("Draft exceeds local storage limits.");
  const draft = JSON.parse(value) as Pick<StudioSource, "metrics" | "glyphs" | "kerning">;
  if (!draft || !Array.isArray(draft.glyphs)) throw new TypeError("Invalid studio draft.");
  const supplement = source.ownerId === "guest" && source.kind === "typeface" && draft.kerning === undefined
    ? proofGlyphs.filter(glyph => !draft.glyphs.some(existing => existing.key === glyph.key)) : [];
  const glyphs = [...draft.glyphs, ...supplement];
  const kerning = draft.kerning ?? (source.kerning ?? []).filter(pair =>
    glyphs.some(glyph => glyph.key === pair.left) && glyphs.some(glyph => glyph.key === pair.right));
  return studioDocument({ ...source, metrics: draft.metrics, glyphs, kerning });
}
