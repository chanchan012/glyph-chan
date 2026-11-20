export interface Point { x: number; y: number }

export type Segment =
  | { kind: "line"; to: Point }
  | { kind: "quadratic"; control: Point; to: Point }
  | { kind: "cubic"; control1: Point; control2: Point; to: Point };

export interface Contour {
  start: Point;
  segments: Segment[];
  closed: boolean;
}

// SVG order maps x and y through [a, b, c, d, e, f].
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
export type BooleanOperation = "union" | "subtract" | "intersect";

const coordinateLimit = 10_000_000;

export function coordinate(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) > coordinateLimit) {
    throw new RangeError("Coordinate is outside the supported design space.");
  }
  return Number(value.toFixed(8)) || 0;
}

export function point(x: number, y: number): Point {
  return { x: coordinate(x), y: coordinate(y) };
}

export function mapContour(contour: Contour, map: (value: Point) => Point): Contour {
  return {
    start: map(contour.start),
    closed: contour.closed,
    segments: contour.segments.map(segment => {
      const to = map(segment.to);
      switch (segment.kind) {
        case "line": return { kind: "line", to };
        case "quadratic": return { kind: "quadratic", to, control: map(segment.control) };
        case "cubic": return { kind: "cubic", to, control1: map(segment.control1), control2: map(segment.control2) };
      }
    }),
  };
}

export function transformContour(contour: Contour, matrix: Matrix): Contour {
  const [a, b, c, d, e, f] = matrix;
  return mapContour(contour, ({ x, y }) => point(a * x + c * y + e, b * x + d * y + f));
}
