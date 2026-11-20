import { Font as TrueTypeWriter, type TTF } from "fonteditor-core";
import { Font, Glyph as OpenTypeGlyph, Path } from "opentype.js";
import { pathBounds, splitSegment } from "../vector/bezier";
import type { Contour, Point, Segment } from "../vector/types";
import type { Glyph, GlyphFoundryState } from "../foundry/types";
import { ExportInputError, exportSlug } from "./contracts";
import { kerningTables } from "./kerning-tables";

type Cubic = Extract<Segment, { kind: "cubic" }>;

// At most this many design units between the cubic and its quadratic approximation.
const approximationError = .4;
const fixedDate = Date.UTC(2020, 0, 1);

function quadraticPieces(from: Point, cubic: Cubic, append: (control: Point, to: Point) => void, depth = 0) {
  const { control1, control2, to } = cubic;
  const control = {
    x: (3 * (control1.x + control2.x) - from.x - to.x) / 4,
    y: (3 * (control1.y + control2.y) - from.y - to.y) / 4,
  };
  // Degree elevation bounds the curve error by the largest control-point error.
  const distance = (end: Point, actual: Point) =>
    Math.hypot((end.x + 2 * control.x) / 3 - actual.x, (end.y + 2 * control.y) / 3 - actual.y);
  if (Math.max(distance(from, control1), distance(to, control2)) <= approximationError) {
    append(control, to);
    return;
  }
  if (depth >= 16) throw new ExportInputError("A curve exceeds TrueType's supported precision.");
  const [first, second] = splitSegment(from, cubic, .5) as [Cubic, Cubic];
  quadraticPieces(from, first, append, depth + 1);
  quadraticPieces(first.to, second, append, depth + 1);
}

function toOpenTypePath(glyph: Glyph, countTotal: (amount: number) => void) {
  const path = new Path();
  const bounds = pathBounds(glyph.contours);
  const dx = bounds ? glyph.metrics.leftBearing - bounds.minX : 0;
  let pointCount = 0;
  function countPoints(amount: number) {
    pointCount += amount;
    if (pointCount > 65535) throw new ExportInputError("A glyph exceeds the TrueType point limit.");
    countTotal(amount);
  }
  const quantize = (x: number) => {
    const rounded = Math.round(x);
    if (rounded < -32768 || rounded > 32767) throw new ExportInputError("An outline exceeds the TrueType coordinate range.");
    return rounded;
  };
  const line = (to: Point) => {
    countPoints(1);
    path.lineTo(quantize(to.x + dx), quantize(-to.y));
  };
  const quad = (control: Point, to: Point) => {
    countPoints(2);
    path.quadraticCurveTo(quantize(control.x + dx), quantize(-control.y), quantize(to.x + dx), quantize(-to.y));
  };
  for (const contour of glyph.contours) {
    if (contour.segments.length === 0) continue;
    let from = contour.start;
    countPoints(1);
    path.moveTo(quantize(from.x + dx), quantize(-from.y));
    for (const segment of contour.segments) {
      if (segment.kind === "line") line(segment.to);
      else if (segment.kind === "quadratic") quad(segment.control, segment.to);
      else quadraticPieces(from, segment, quad);
      from = segment.to;
    }
    path.close();
  }
  return path;
}

function trueTypeContours(path: Path): TTF.Contour[] {
  const contours: TTF.Contour[] = [];
  let contour: TTF.Contour = [];
  let x = 0;
  let y = 0;
  function add(nextX: number, nextY: number, onCurve: boolean) {
    if (nextX - x < -32768 || nextX - x > 32767 || nextY - y < -32768 || nextY - y > 32767) {
      throw new ExportInputError("An outline has a point interval too large for TrueType.");
    }
    contour.push({ x: nextX, y: nextY, onCurve });
    x = nextX;
    y = nextY;
  }
  for (const command of path.commands) {
    if (command.type === "M") {
      contour = [];
      add(command.x, command.y, true);
    } else if (command.type === "L") add(command.x, command.y, true);
    else if (command.type === "Q") {
      add(command.x1, command.y1, false);
      add(command.x, command.y, true);
    } else if (command.type === "Z") {
      if (contours.length >= 32767) throw new ExportInputError("A glyph exceeds the TrueType contour limit.");
      contours.push(contour);
    }
  }
  return contours;
}

function boundingBox(contours: TTF.Contour[]) {
  if (!contours.length) return { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  const points = contours.flat();
  return {
    xMin: Math.min(...points.map(point => point.x)), xMax: Math.max(...points.map(point => point.x)),
    yMin: Math.min(...points.map(point => point.y)), yMax: Math.max(...points.map(point => point.y)),
  };
}

function missingGlyph(units: number): Contour[] {
  const width = Math.round(units * .5);
  const height = Math.round(units * .65);
  const stroke = Math.max(1, Math.round(units * .045));
  return [
    { start: { x: 0, y: 0 }, closed: true, segments: [
      { kind: "line", to: { x: width, y: 0 } }, { kind: "line", to: { x: width, y: -height } },
      { kind: "line", to: { x: 0, y: -height } },
    ] },
    { start: { x: stroke, y: -stroke }, closed: true, segments: [
      { kind: "line", to: { x: stroke, y: -height + stroke } },
      { kind: "line", to: { x: width - stroke, y: -height + stroke } },
      { kind: "line", to: { x: width - stroke, y: -stroke } },
    ] },
  ];
}

export function buildTrueType(document: GlyphFoundryState, familyName: string) {
  if (document.kind !== "typeface") throw new ExportInputError("Select a typeface to export a font.");
  const outlines = Object.values(document.glyphs).sort((a, b) => a.key.codePointAt(0)! - b.key.codePointAt(0)!);
  if (!outlines.length) throw new ExportInputError("Add at least one glyph before exporting a font.");
  const { unitsPerEm, ascender, descender, xHeight, capHeight } = document.metrics;
  let pointCount = 0;
  function countTotal(amount: number) {
    pointCount += amount;
    if (pointCount > 200_000) throw new ExportInputError("The font exceeds the export complexity limit.");
  }
  const missing = new OpenTypeGlyph({
    name: ".notdef",
    advanceWidth: Math.round(unitsPerEm * .6),
    path: toOpenTypePath({ key: "", contours: missingGlyph(unitsPerEm), metrics: { advanceWidth: 0, leftBearing: Math.round(unitsPerEm * .05), rightBearing: 0 } }, countTotal),
  });
  const space = new OpenTypeGlyph({ name: "space", unicode: 32, advanceWidth: Math.round(unitsPerEm * .33), path: new Path() });
  const mapped = outlines.map(glyph => new OpenTypeGlyph({
    name: "uni" + glyph.key.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"),
    unicode: glyph.key.codePointAt(0),
    advanceWidth: glyph.metrics.advanceWidth,
    path: toOpenTypePath(glyph, countTotal),
  }));
  const font = new Font({
    familyName, styleName: "Regular", unitsPerEm, ascender, descender,
    glyphs: [missing, ...(!Object.hasOwn(document.glyphs, " ") ? [space] : []), ...mapped],
  });
  const writer = TrueTypeWriter.create();
  const data = writer.get() as TTF.TTFObject & { GPOS?: Uint8Array; kern?: Uint8Array };
  const glyphIds = new Map<string, number>();
  data.glyf = Array.from({ length: font.glyphs.length }, (_, index) => {
    const glyph = font.glyphs.get(index);
    const contours = trueTypeContours(glyph.path);
    const bounds = boundingBox(contours);
    if (glyph.unicode !== undefined) glyphIds.set(String.fromCodePoint(glyph.unicode), index);
    return {
      name: glyph.name ?? "glyph" + index, contours, ...bounds, advanceWidth: glyph.advanceWidth ?? 0,
      unicode: glyph.unicode === undefined ? [] : [glyph.unicode],
      // The coordinates already account for the visual left sidebearing. xMin uses control points.
      leftSideBearing: bounds.xMin,
    };
  });
  data.head.unitsPerEm = unitsPerEm;
  data.head.created = fixedDate;
  data.head.modified = fixedDate;
  Object.assign(data.hhea, { ascent: ascender, descent: descender, lineGap: 0 });
  Object.assign(data["OS/2"], {
    sTypoAscender: ascender, sTypoDescender: descender, sTypoLineGap: 0, sxHeight: xHeight, sCapHeight: capHeight,
    usWinAscent: Math.max(ascender, ...data.glyf.map(glyph => glyph.yMax)),
    usWinDescent: Math.max(-descender, ...data.glyf.map(glyph => -glyph.yMin)),
    achVendID: "GLYP",
  });
  const postScriptName = exportSlug(familyName).slice(0, 54) + "-Regular";
  Object.assign(data.name, {
    fontFamily: familyName, fontSubFamily: "Regular", fullName: familyName + " Regular",
    uniqueSubFamily: postScriptName + ":1.000", version: "Version 1.000", postScriptName,
  });
  Object.assign(data, kerningTables(document.kerning.map(pair => ({
    left: glyphIds.get(pair.left)!, right: glyphIds.get(pair.right)!, delta: pair.adjustment,
  }))));
  const output = writer.write({ type: "ttf", toBuffer: false, kerning: true });
  if (!(output instanceof ArrayBuffer)) throw Error("TrueType writer returned an unexpected output.");
  return new Uint8Array(output);
}
