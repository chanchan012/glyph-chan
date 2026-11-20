import type { Contour, Point, Segment } from "./types";

export function interpolate(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

export function evaluateSegment(from: Point, segment: Segment, t: number): Point {
  if (segment.kind === "line") return interpolate(from, segment.to, t);
  if (segment.kind === "quadratic") {
    return interpolate(interpolate(from, segment.control, t), interpolate(segment.control, segment.to, t), t);
  }
  const first = interpolate(from, segment.control1, t);
  const middle = interpolate(segment.control1, segment.control2, t);
  const last = interpolate(segment.control2, segment.to, t);
  return interpolate(interpolate(first, middle, t), interpolate(middle, last, t), t);
}

export function splitSegment(from: Point, segment: Segment, t: number): [Segment, Segment] {
  if (!Number.isFinite(t) || t <= 0 || t >= 1) throw new RangeError("Split parameter must be between zero and one.");
  const { to } = segment;
  if (segment.kind === "line") {
    return [{ kind: "line", to: interpolate(from, to, t) }, { kind: "line", to }];
  }
  if (segment.kind === "quadratic") {
    const left = interpolate(from, segment.control, t);
    const right = interpolate(segment.control, to, t);
    return [
      { kind: "quadratic", control: left, to: interpolate(left, right, t) },
      { kind: "quadratic", control: right, to },
    ];
  }
  const first = interpolate(from, segment.control1, t);
  const middle = interpolate(segment.control1, segment.control2, t);
  const last = interpolate(segment.control2, to, t);
  const left = interpolate(first, middle, t);
  const right = interpolate(middle, last, t);
  return [
    { kind: "cubic", control1: first, control2: left, to: interpolate(left, right, t) },
    { kind: "cubic", control1: right, control2: last, to },
  ];
}

export function quadraticAsCubic(from: Point, segment: Extract<Segment, { kind: "quadratic" }>): Extract<Segment, { kind: "cubic" }> {
  return {
    kind: "cubic",
    control1: interpolate(from, segment.control, 2 / 3),
    control2: interpolate(segment.to, segment.control, 2 / 3),
    to: segment.to,
  };
}

function derivativeRoots(from: number, first: number, second: number, end: number) {
  const a = -from + 3 * first - 3 * second + end;
  const b = 2 * (from - 2 * first + second);
  const c = first - from;
  if (a === 0) return b === 0 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  if (discriminant === 0) return [-b / (2 * a)];
  const major = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(discriminant));
  return [major / a, c / major];
}

function extrema(from: Point, segment: Segment, axis: keyof Point) {
  const start = from[axis];
  const end = segment.to[axis];
  if (segment.kind === "line") return [];
  if (segment.kind === "cubic") {
    return derivativeRoots(start, segment.control1[axis], segment.control2[axis], end);
  }
  const control = segment.control[axis];
  const denominator = start - 2 * control + end;
  return denominator === 0 ? [] : [(start - control) / denominator];
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export function pathBounds(contours: readonly Contour[]): Bounds | null {
  if (!contours.length) return null;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  function extend({ x, y }: Point) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  for (const contour of contours) {
    let from = contour.start;
    extend(from);
    for (const segment of contour.segments) {
      extend(segment.to);
      for (const root of [...extrema(from, segment, "x"), ...extrema(from, segment, "y")]) {
        if (root > 0 && root < 1) extend(evaluateSegment(from, segment, root));
      }
      from = segment.to;
    }
  }
  return bounds;
}
