import { describe, expect, it } from "vitest";
import { evaluateSegment, pathBounds, quadraticAsCubic, splitSegment } from "../../src/lib/vector/bezier";
import { booleanPath } from "../../src/lib/vector/boolean";
import { ellipse, rectangle } from "../../src/lib/vector/primitives";
import { parsePath, serializePath } from "../../src/lib/vector/svg";
import { point, transformContour, type Contour, type Segment } from "../../src/lib/vector/types";

const box = (x: number, y: number, width: number, height: number) => rectangle(point(x, y), point(x + width, y + height));

function area(contours: Contour[]): number {
  return Math.abs(contours.reduce((sum, contour) => {
    let from = contour.start;
    let twice = 0;
    for (const segment of contour.segments) {
      let previous = from;
      for (let step = 1; step <= 40; step++) {
        const next = evaluateSegment(from, segment, step / 40);
        twice += previous.x * next.y - previous.y * next.x;
        previous = next;
      }
      from = segment.to;
    }
    return sum + (twice + from.x * contour.start.y - from.y * contour.start.x) / 2;
  }, 0));
}

describe("SVG path normalization", () => {
  it("normalizes relative, implicit, smooth, horizontal, and vertical commands", () => {
    const input = "m10 20 30-5 h5 v5 q10 5 20 0 t10-5 c0 5 5 10 5 20 s5 5 10 10z";
    const contours = parsePath(input);
    expect(serializePath(contours)).toBe(
      "M 10 20 L 40 15 L 45 15 L 45 20 Q 55 25 65 20 Q 75 15 75 15 C 75 20 80 25 80 35 C 80 45 85 40 90 45 Z",
    );
    expect(parsePath(serializePath(contours))).toEqual(contours);
  });
  it("converts arcs, preserves holes and supports drawing after closepath", () => {
    const contours = parsePath("M0 0 A10 10 0 0 1 20 0 Z l5 5 M5 1 h10 v1 h-10 z");
    expect(contours).toHaveLength(3);
    expect(contours[0].segments.map(segment => segment.kind)).toEqual(["cubic", "cubic"]);
    expect(contours[0].segments.at(-1)?.to).toEqual(point(20, 0));
    expect(contours[1]).toEqual({ start: point(0, 0), closed: false, segments: [{ kind: "line", to: point(5, 5) }] });
    expect(contours[2].closed).toBe(true);
  });
  it("rejects malformed or nonfinite coordinates", () => {
    for (const invalid of ["L1 2", "M0 0 L1", "M0 0X1 2", "M1e999 0"]) expect(() => parsePath(invalid)).toThrow();
    expect(serializePath(parsePath("  "))).toBe("");
  });
});

describe("Bézier math", () => {
  const origin = point(0, 0);
  const quadratic: Segment = { kind: "quadratic", control: point(50, 100), to: point(100, 0) };
  const cubic: Segment = { kind: "cubic", control1: point(0, 100), control2: point(100, 100), to: point(100, 0) };

  it("evaluates and converts a quadratic without changing its geometry", () => {
    expect(evaluateSegment(origin, quadratic, .5)).toEqual(point(50, 50));
    const converted = quadraticAsCubic(origin, quadratic);
    for (const t of [0, .13, .5, .9, 1]) {
      const actual = evaluateSegment(origin, converted, t);
      const expected = evaluateSegment(origin, quadratic, t);
      expect(actual.x).toBeCloseTo(expected.x, 10);
      expect(actual.y).toBeCloseTo(expected.y, 10);
    }
  });
  it("uses curve extrema for bounds", () => {
    expect(pathBounds([{ start: origin, segments: [cubic], closed: false }])).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 75 });
    expect(pathBounds([{ start: origin, segments: [quadratic], closed: false }])?.maxY).toBe(50);
    expect(pathBounds([])).toBeNull();
  });
  it("splits line, quadratic, and cubic contours with stable parameterization", () => {
    for (const segment of [quadratic, cubic, { kind: "line", to: point(10, 20) } as const]) {
      const split = .37;
      const [before, after] = splitSegment(origin, segment, split);
      expect(before.to).toEqual(evaluateSegment(origin, segment, split));
      const pointOnRight = evaluateSegment(before.to, after, .62);
      const pointOnOriginal = evaluateSegment(origin, segment, split + (1 - split) * .62);
      expect(pointOnRight.x).toBeCloseTo(pointOnOriginal.x, 10);
      expect(pointOnRight.y).toBeCloseTo(pointOnOriginal.y, 10);
      expect(after.to).toEqual(segment.to);
    }
    expect(() => splitSegment(origin, cubic, 1)).toThrow();
  });
  it("transforms both anchors and handles", () => {
    const outline = parsePath("M0 0 Q20 10 40 30");
    const transformed = transformContour(outline[0], [0, 1, -1, 0, 5, 6]);
    expect(serializePath([transformed])).toBe("M 5 6 Q -5 26 -25 46");
  });
});

describe("boolean paths", () => {
  it("unions, subtracts and intersects overlapping outlines", () => {
    const first = [box(0, 0, 10, 10)];
    const second = [box(5, 0, 10, 10)];
    expect(area(booleanPath("union", first, second))).toBeCloseTo(150, 6);
    expect(area(booleanPath("subtract", first, second))).toBeCloseTo(50, 6);
    expect(area(booleanPath("intersect", first, second))).toBeCloseTo(50, 6);
    expect(booleanPath("intersect", first, [box(20, 0, 10, 10)])).toEqual([]);
    expect(booleanPath("subtract", first, first)).toEqual([]);
  });

  it("preserves holes, disconnected outlines, and cubic segments", () => {
    const outer = [box(0, 0, 20, 20)];
    const hole = [box(5, 5, 10, 10)];
    const ring = booleanPath("subtract", outer, hole);
    expect(ring).toHaveLength(2);
    expect(area(ring)).toBeCloseTo(300, 6);
    expect(booleanPath("intersect", ring, [box(7, 7, 2, 2)])).toEqual([]);
    expect(booleanPath("union", ring, [box(30, 0, 5, 5)])).toHaveLength(3);
    const curved = booleanPath("intersect", [ellipse(point(0, 0), point(20, 20))], [box(10, 0, 10, 20)]);
    expect(curved.flatMap(path => path.segments).some(segment => segment.kind === "cubic")).toBe(true);
    expect(area(curved)).toBeCloseTo(Math.PI * 50, 0);
  });

  it("rejects open shapes", () => {
    expect(() => booleanPath("union", parsePath("M0 0 L10 10"), [box(0, 0, 10, 10)])).toThrow(/closed contours/);
  });
});
