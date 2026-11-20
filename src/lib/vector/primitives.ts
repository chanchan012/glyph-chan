import { point, type Contour, type Point } from "./types";

function dimensions(from: Point, to: Point) {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);
  if (left === right || top === bottom) throw new RangeError("A primitive needs positive width and height.");
  return { left, right, top, bottom };
}

export function rectangle(from: Point, to: Point): Contour {
  const { left, right, top, bottom } = dimensions(from, to);
  return {
    start: point(left, top), closed: true,
    segments: [
      { kind: "line", to: point(right, top) },
      { kind: "line", to: point(right, bottom) },
      { kind: "line", to: point(left, bottom) },
    ],
  };
}

const quarterCircle = 4 * (Math.SQRT2 - 1) / 3;

export function ellipse(from: Point, to: Point): Contour {
  const { left, right, top, bottom } = dimensions(from, to);
  const x = (left + right) / 2;
  const y = (top + bottom) / 2;
  const dx = (right - left) * quarterCircle / 2;
  const dy = (bottom - top) * quarterCircle / 2;
  return {
    start: point(x, top), closed: true,
    segments: [
      { kind: "cubic", control1: point(x + dx, top), control2: point(right, y - dy), to: point(right, y) },
      { kind: "cubic", control1: point(right, y + dy), control2: point(x + dx, bottom), to: point(x, bottom) },
      { kind: "cubic", control1: point(x - dx, bottom), control2: point(left, y + dy), to: point(left, y) },
      { kind: "cubic", control1: point(left, y - dy), control2: point(x - dx, top), to: point(x, top) },
    ],
  };
}
