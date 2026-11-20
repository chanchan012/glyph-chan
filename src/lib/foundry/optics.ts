import { evaluateSegment, pathBounds, segmentExtrema, type Bounds } from "../vector/bezier";
import type { Contour, Point, Segment } from "../vector/types";
import type { FoundryMetrics, Glyph, GlyphFoundryState } from "./types";

type Axis = keyof Point;
type CurveInterval = { start: Point; segment: Segment; from: number; to: number; first: number; last: number };

function monotoneIntervals(contours: Contour[], axis: Axis) {
  const intervals: CurveInterval[] = [];
  for (const contour of contours) {
    let start = contour.start;
    const segments: Segment[] = [...contour.segments, { kind: "line", to: contour.start }];
    for (const segment of segments) {
      const roots = segmentExtrema(start, segment, axis).filter(root => root > 0 && root < 1).sort((a, b) => a - b);
      const ends = [...roots, 1];
      let from = 0;
      let first = start[axis];
      for (const to of ends) {
        const last = evaluateSegment(start, segment, to)[axis];
        if (first !== last) intervals.push({ start, segment, from, to, first, last });
        from = to;
        first = last;
      }
      start = segment.to;
    }
  }
  return intervals;
}

function inkRuns(value: number, axis: Axis, intervals: CurveInterval[]) {
  const crossAxis = axis === "x" ? "y" : "x";
  const crossings = intervals.flatMap(({ start, segment, from, to, first, last }) => {
    // A shared endpoint contributes once. A tangent pair cancels by winding.
    if (value < Math.min(first, last) || value >= Math.max(first, last)) return [];
    const rising = last > first;
    if (segment.kind === "line") {
      const t = (value - first) / (last - first);
      return [{ position: evaluateSegment(start, segment, t)[crossAxis], direction: rising ? 1 : -1 }];
    }
    let low = from;
    let high = to;
    for (let step = 0; step < 32; step++) {
      const mid = (low + high) / 2;
      if ((evaluateSegment(start, segment, mid)[axis] < value) === rising) low = mid;
      else high = mid;
    }
    return [{ position: evaluateSegment(start, segment, (low + high) / 2)[crossAxis], direction: rising ? 1 : -1 }];
  }).sort((a, b) => a.position - b.position);
  const runs: number[] = [];
  let winding = 0;
  let start = 0;
  for (let index = 0; index < crossings.length;) {
    const position = crossings[index].position;
    const before = winding;
    do { winding += crossings[index++].direction; }
    while (index < crossings.length && Math.abs(crossings[index].position - position) < 1e-6);
    if (before === 0 && winding !== 0) start = position;
    if (before !== 0 && winding === 0 && position - start > 1e-6) runs.push(position - start);
  }
  return runs;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
}

function measureAxis(contours: Contour[], bounds: Bounds, axis: Axis) {
  const start = axis === "y" ? bounds.minY : bounds.minX;
  const span = (axis === "y" ? bounds.maxY : bounds.maxX) - start;
  if (span <= 0) return null;
  const intervals = monotoneIntervals(contours, axis);
  const samples: number[] = [];
  for (let index = 0; index < 11; index++) {
    const value = start + span * (.225 + index * .055);
    const runs = inkRuns(value, axis, intervals);
    if (runs.length) samples.push(Math.min(...runs));
  }
  const measurement = median(samples);
  return measurement === null ? null : Math.round(measurement * 100) / 100;
}

export function measureStemWidths(contours: Contour[]) {
  const closed = contours.filter(contour => contour.closed && contour.segments.length > 0);
  const bounds = pathBounds(closed);
  return {
    bounds,
    vertical: bounds ? measureAxis(closed, bounds, "y") : null,
    horizontal: bounds ? measureAxis(closed, bounds, "x") : null,
  };
}

function guidesFor(key: string, metrics: FoundryMetrics) {
  if (!/[\p{Letter}\p{Number}]/u.test(key)) return null;
  const top = "bdfhklt".includes(key) ? "ascender" : /\p{Ll}/u.test(key) ? "xHeight" : "capHeight";
  const bottom = "gjpqy".includes(key) ? "descender" : "baseline";
  return { top, topY: -metrics[top], bottom, bottomY: bottom === "baseline" ? 0 : -metrics.descender } as const;
}

export function auditOpticalConsistency(document: GlyphFoundryState, options: {
  stemTarget?: number; stemTolerance?: number; overshootTolerance?: number;
} = {}) {
  const stemTolerance = options.stemTolerance ?? Math.max(1, Math.round(document.metrics.unitsPerEm * .025));
  const overshootTolerance = options.overshootTolerance ?? Math.max(1, Math.round(document.metrics.unitsPerEm * .025));
  const glyphs = Object.values(document.glyphs).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const measured = glyphs.map(glyph => ({ glyph, ...measureStemWidths(glyph.contours) }));
  const stemReference = options.stemTarget ?? median(measured.flatMap(row => row.vertical === null ? [] : [row.vertical]));
  function measureOvershoot(glyph: Glyph, bounds: Bounds | null) {
    const guides = document.kind === "typeface" ? guidesFor(glyph.key, document.metrics) : null;
    if (!guides || !bounds) return null;
    const top = guides.topY - bounds.minY;
    const bottom = bounds.maxY - guides.bottomY;
    return {
      top: Math.round(top * 100) / 100, bottom: Math.round(bottom * 100) / 100,
      topGuide: guides.top, bottomGuide: guides.bottom,
      outsideTolerance: Math.abs(top) > overshootTolerance || Math.abs(bottom) > overshootTolerance,
    };
  }
  const rows = measured.map(({ glyph, bounds, vertical, horizontal }) => ({
    key: glyph.key, vertical, horizontal,
    stemOutsideTolerance: stemReference !== null && vertical !== null && Math.abs(vertical - stemReference) > stemTolerance,
    overshoot: measureOvershoot(glyph, bounds),
  }));
  return { rows, stemReference, stemTolerance, overshootTolerance };
}
