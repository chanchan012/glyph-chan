import svgpath from "svgpath";
import { coordinate, point, type Contour, type Point } from "./types";

const maxPathLength = 500_000;

export function parsePath(data: string): Contour[] {
  if (data.length > maxPathLength) throw new RangeError("SVG path data is too long.");
  const parsed = svgpath(data);
  // svgpath reports grammar errors on the instance instead of throwing.
  const error = (parsed as typeof parsed & { err: string }).err;
  if (error) throw new SyntaxError(error);

  const contours: Contour[] = [];
  let active: Contour | undefined;
  function begin(start: Point) {
    return { start, segments: [], closed: false };
  }
  parsed.abs().unshort().unarc().iterate((segment, _, x, y) => {
    if (segment[0] === "M") {
      active = begin(point(segment[1], segment[2]));
      contours.push(active);
      return;
    }
    if (segment[0] === "Z" || segment[0] === "z") {
      if (active) active.closed = true;
      return;
    }
    if (!active || active.closed) {
      active = begin(point(x, y));
      contours.push(active);
    }
    switch (segment[0]) {
      case "L":
        active.segments.push({ kind: "line", to: point(segment[1], segment[2]) });
        break;
      case "H":
        active.segments.push({ kind: "line", to: point(segment[1], y) });
        break;
      case "V":
        active.segments.push({ kind: "line", to: point(x, segment[1]) });
        break;
      case "Q":
        active.segments.push({ kind: "quadratic", control: point(segment[1], segment[2]), to: point(segment[3], segment[4]) });
        break;
      case "C":
        active.segments.push({ kind: "cubic", control1: point(segment[1], segment[2]), control2: point(segment[3], segment[4]), to: point(segment[5], segment[6]) });
        break;
      default:
        throw new SyntaxError("SVG command normalization failed.");
    }
  });
  return contours;
}

function pair({ x, y }: Point) {
  return `${coordinate(x)} ${coordinate(y)}`;
}

export function serializePath(contours: readonly Contour[]): string {
  return contours.map(contour => {
    const commands = [`M ${pair(contour.start)}`];
    for (const segment of contour.segments) {
      switch (segment.kind) {
        case "line":
          commands.push(`L ${pair(segment.to)}`);
          break;
        case "quadratic":
          commands.push(`Q ${pair(segment.control)} ${pair(segment.to)}`);
          break;
        case "cubic":
          commands.push(`C ${pair(segment.control1)} ${pair(segment.control2)} ${pair(segment.to)}`);
          break;
      }
    }
    if (contour.closed) commands.push("Z");
    return commands.join(" ");
  }).join(" ");
}
