import { specimens } from "../specimens";
import { parsePath, serializePath } from "../vector/svg";
import { transformContour } from "../vector/types";
import { createFoundry, recordCommand } from "./document";
import type { FoundryCommand, FoundryMetrics, GlyphFoundryState, GlyphMetrics } from "./types";

export interface StudioSource {
  id: string;
  name: string;
  ownerId: string;
  kind: GlyphFoundryState["kind"];
  metrics: FoundryMetrics;
  glyphs: { key: string; paths: string[]; metrics: GlyphMetrics }[];
}

export function studioDocument(source: StudioSource) {
  let document = createFoundry(source.id, source.kind, source.metrics);
  for (const glyph of source.glyphs) {
    document = recordCommand(document, {
      id: "hydrate:" + glyph.key,
      actor: { kind: "human", id: source.ownerId },
      timestamp: "1970-01-01T00:00:00.000Z",
      command: { type: "createGlyph", key: glyph.key, metrics: glyph.metrics, contours: glyph.paths.flatMap(parsePath) },
    }).state;
  }
  return { ...document, revision: 0 };
}

const demoMetrics = { unitsPerEm: 1000, ascender: 780, descender: -220, capHeight: 685, xHeight: 525 };
const demoGlyphMetrics = { advanceWidth: 700, leftBearing: 60, rightBearing: 60 };

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
      : [preset, ...specimens.slice(0, 3).filter(specimen => specimen !== preset)]
        .map(specimen => specimenGlyph(specimen, specimen.char)),
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
    glyphs: Object.values(document.glyphs).map(({ key, metrics, contours }) => ({
      key, metrics, paths: contours.map(contour => serializePath([contour])),
    })),
  });
}

export function decodeStudioDraft(source: StudioSource, value: string) {
  if (value.length > 1_500_000) throw new RangeError("Draft exceeds local storage limits.");
  const draft = JSON.parse(value) as Pick<StudioSource, "metrics" | "glyphs">;
  if (!draft || !Array.isArray(draft.glyphs)) throw new TypeError("Invalid studio draft.");
  return studioDocument({ ...source, metrics: draft.metrics, glyphs: draft.glyphs });
}
