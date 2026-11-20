import { applyPatches, enablePatches, freeze, produceWithPatches, type Patch } from "immer";
import { splitSegment } from "../vector/bezier";
import { booleanPath } from "../vector/boolean";
import { mapContour, point, transformContour, type Contour, type Point, type Segment } from "../vector/types";
import type { CommandEnvelope, FoundryCommand, FoundryMetrics, Glyph, GlyphFoundryState, GlyphMetrics } from "./types";

enablePatches();

const defaultMetrics: FoundryMetrics = { unitsPerEm: 1000, ascender: 800, descender: -200, capHeight: 700, xHeight: 500 };
const defaultGlyphMetrics: GlyphMetrics = { advanceWidth: 600, leftBearing: 50, rightBearing: 50 };

function integer(value: number, min: number, max: number) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function foundryMetrics(metrics: FoundryMetrics): FoundryMetrics {
  const { unitsPerEm, ascender, descender, capHeight, xHeight } = metrics;
  if (!integer(unitsPerEm, 16, 16384) || !integer(descender, -32768, 0)
      || !integer(ascender, 1, 32767) || !integer(capHeight, 1, ascender) || !integer(xHeight, 1, capHeight)) {
    throw new RangeError("Invalid optical metrics.");
  }
  return { unitsPerEm, ascender, descender, capHeight, xHeight };
}

function glyphMetrics(metrics: GlyphMetrics): GlyphMetrics {
  const { advanceWidth, leftBearing, rightBearing } = metrics;
  if (!integer(advanceWidth, 0, 65535) || !integer(leftBearing, -32768, 32767) || !integer(rightBearing, -32768, 32767)) {
    throw new RangeError("Invalid glyph metrics.");
  }
  return { advanceWidth, leftBearing, rightBearing };
}

export function createFoundry(
  id: string,
  kind: GlyphFoundryState["kind"],
  metrics: FoundryMetrics = defaultMetrics,
): GlyphFoundryState {
  if (!id.trim()) throw new RangeError("A foundry ID is required.");
  return freeze({ id, kind, revision: 0, metrics: foundryMetrics(metrics), glyphs: {} }, true);
}

function requireGlyph(state: GlyphFoundryState, key: string): Glyph {
  if (!Object.hasOwn(state.glyphs, key)) throw new RangeError("Glyph does not exist.");
  return state.glyphs[key];
}

function validKey(state: GlyphFoundryState, key: string) {
  if (!key || key.length > 80 || /[\p{Cc}\p{Cs}]/u.test(key)
      || key === "__proto__" || key === "constructor" || key === "prototype"
      || (state.kind === "typeface" && Array.from(key).length !== 1)) {
    throw new RangeError("Invalid glyph key.");
  }
}

function at<T>(items: T[], index: number): T {
  if (!integer(index, 0, items.length - 1)) throw new RangeError("Contour, anchor or handle index is out of range.");
  return items[index];
}

const copyPoint = ({ x, y }: Point) => point(x, y);
const copyContour = (contour: Contour) => mapContour(contour, copyPoint);

function contourSelection(glyph: Glyph, indices: number[]) {
  if (indices.length !== new Set(indices).size) throw new RangeError("Contour selection contains duplicate indices.");
  return indices.map(index => at(glyph.contours, index));
}

function moveAnchor(contour: Contour, index: number, to: Point, moveHandles: boolean) {
  const last = contour.segments.at(-1);
  const returnsToStart = contour.closed && last?.to.x === contour.start.x && last.to.y === contour.start.y;
  const anchor = returnsToStart && index === contour.segments.length ? 0 : index;
  const incoming = anchor === 0 ? (returnsToStart ? last : undefined) : at(contour.segments, anchor - 1);
  const outgoing = contour.segments[anchor];
  const current = anchor === 0 ? contour.start : incoming!.to;
  const next = copyPoint(to);
  if (current.x === next.x && current.y === next.y) return;

  const translate = (handle: Point) => point(handle.x + next.x - current.x, handle.y + next.y - current.y);
  if (moveHandles) {
    if (incoming?.kind === "quadratic") incoming.control = translate(incoming.control);
    if (incoming?.kind === "cubic") incoming.control2 = translate(incoming.control2);
    if (outgoing?.kind === "quadratic" && outgoing !== incoming) outgoing.control = translate(outgoing.control);
    if (outgoing?.kind === "cubic") outgoing.control1 = translate(outgoing.control1);
  }
  if (anchor === 0) contour.start = next;
  if (incoming) incoming.to = copyPoint(next);
}

function replaceHandle(segment: Segment, handle: "control" | "control1" | "control2", to: Point) {
  if (segment.kind === "quadratic" && handle === "control") {
    if (segment.control.x !== to.x || segment.control.y !== to.y) segment.control = copyPoint(to);
    return;
  }
  if (segment.kind === "cubic" && handle !== "control") {
    if (segment[handle].x !== to.x || segment[handle].y !== to.y) segment[handle] = copyPoint(to);
    return;
  }
  throw new RangeError("The selected segment does not have that handle.");
}

function edit(state: GlyphFoundryState, command: FoundryCommand) {
  if (command.type === "setFoundryMetrics") {
    Object.assign(state.metrics, foundryMetrics(command.metrics));
    return;
  }
  if (command.type === "createGlyph") {
    validKey(state, command.key);
    if (Object.hasOwn(state.glyphs, command.key)) throw new RangeError("Glyph already exists.");
    state.glyphs[command.key] = {
      key: command.key,
      metrics: glyphMetrics(command.metrics ?? defaultGlyphMetrics),
      contours: (command.contours ?? []).map(copyContour),
    };
    return;
  }

  const glyph = requireGlyph(state, command.key);
  switch (command.type) {
    case "deleteGlyph":
      delete state.glyphs[command.key];
      break;
    case "replaceContours":
      glyph.contours = command.contours.map(copyContour);
      break;
    case "appendContour":
      glyph.contours.push(copyContour(command.contour));
      break;
    case "deleteContour":
      at(glyph.contours, command.contour);
      glyph.contours.splice(command.contour, 1);
      break;
    case "appendSegment": {
      const contour = at(glyph.contours, command.contour);
      if (contour.closed) throw new RangeError("Cannot append a segment to a closed contour.");
      const copy = copyContour({ start: contour.start, closed: false, segments: [command.segment] });
      contour.segments.push(copy.segments[0]);
      break;
    }
    case "closeContour": {
      const contour = at(glyph.contours, command.contour);
      if (!contour.segments.length) throw new RangeError("A contour needs at least one segment.");
      contour.closed = true;
      break;
    }
    case "moveAnchor":
      moveAnchor(at(glyph.contours, command.contour), command.anchor, command.to, command.moveHandles ?? true);
      break;
    case "moveHandle":
      replaceHandle(at(at(glyph.contours, command.contour).segments, command.segment), command.handle, command.to);
      break;
    case "splitSegment": {
      const contour = at(glyph.contours, command.contour);
      const segment = at(contour.segments, command.segment);
      const from = command.segment === 0 ? contour.start : contour.segments[command.segment - 1].to;
      const copy = copyContour({ start: from, closed: false, segments: splitSegment(from, segment, command.t) });
      contour.segments.splice(command.segment, 1, ...copy.segments);
      break;
    }
    case "transformContours": {
      const indices = command.indices ?? glyph.contours.map((_, index) => index);
      const transformed = contourSelection(glyph, indices).map(item => transformContour(item, command.matrix));
      for (const [position, index] of indices.entries()) glyph.contours[index] = transformed[position];
      break;
    }
    case "applyBoolean": {
      const indices = [...command.subject, ...command.clip];
      const selected = contourSelection(glyph, indices);
      const result = booleanPath(command.operation, selected.slice(0, command.subject.length), selected.slice(command.subject.length));
      const first = Math.min(...indices);
      const selectedIndices = new Set(indices);
      glyph.contours = glyph.contours.flatMap((contour, index) =>
        index === first ? result : selectedIndices.has(index) ? [] : [contour]);
      break;
    }
    case "setGlyphMetrics":
      Object.assign(glyph.metrics, glyphMetrics(command.metrics));
      break;
  }
}

function validateEnvelope(envelope: CommandEnvelope) {
  const timestamp = new Date(envelope.timestamp);
  if (!envelope.id.trim() || !envelope.actor.id.trim()
      || (envelope.actor.kind !== "human" && envelope.actor.kind !== "agent")
      || !Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== envelope.timestamp) {
    throw new RangeError("Invalid command attribution.");
  }
}

export function recordCommand(state: GlyphFoundryState, envelope: CommandEnvelope) {
  validateEnvelope(envelope);
  if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== state.revision) {
    throw new RangeError("Foundry revision is stale.");
  }
  const [edited, patches, inverse] = produceWithPatches(state, draft => edit(draft, envelope.command));
  return {
    state: patches.length ? freeze({ ...edited, revision: state.revision + 1 }) : state,
    patches,
    inverse,
  };
}

export function applyHistoryPatches(state: GlyphFoundryState, patches: Patch[]) {
  return freeze({ ...applyPatches(state, patches), revision: state.revision + 1 });
}

export function replayCommands(state: GlyphFoundryState, commands: readonly CommandEnvelope[]) {
  return commands.reduce((current, envelope) => recordCommand(current, envelope).state, state);
}
