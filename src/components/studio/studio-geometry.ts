import type { Contour, Point, Segment } from "@/lib/vector/types";
import type { FoundryMetrics, Glyph } from "@/lib/foundry/types";
import { pathBounds } from "@/lib/vector/bezier";

export type Tool = "node" | "pen" | "rectangle" | "ellipse";
export type Curve = "cubic" | "quadratic" | "line";
export type Handle = "control" | "control1" | "control2";
export type NodeTarget = { contour: number } & (
  { type: "anchor"; anchor: number } | { type: "handle"; segment: number; handle: Handle }
);

export type PenNode = { anchor: Point; tangent?: Point };

export function penSegment(from: PenNode, to: PenNode, curve: Curve): Segment {
  if (curve === "line" || (!from.tangent && !to.tangent)) return { kind: "line", to: to.anchor };
  const incoming = to.tangent && { x: 2 * to.anchor.x - to.tangent.x, y: 2 * to.anchor.y - to.tangent.y };
  if (curve === "quadratic") {
    return { kind: "quadratic", control: incoming ?? from.tangent ?? from.anchor, to: to.anchor };
  }
  return { kind: "cubic", control1: from.tangent ?? from.anchor, control2: incoming ?? to.anchor, to: to.anchor };
}

export function penContour(nodes: PenNode[], curve: Curve, closed: boolean): Contour | null {
  if (nodes.length < 2) return null;
  const segments = nodes.slice(1).map((node, index) => penSegment(nodes[index], node, curve));
  if (closed) {
    const closing = penSegment(nodes[nodes.length - 1], nodes[0], curve);
    if (closing.kind !== "line") segments.push(closing);
  }
  return { start: nodes[0].anchor, segments, closed };
}

export function glyphFrame(metrics: FoundryMetrics, glyph?: Glyph) {
  const bounds = pathBounds(glyph?.contours ?? []);
  const padding = Math.max(metrics.unitsPerEm * .13, 30);
  const x = Math.min(bounds?.minX ?? 0, 0, glyph?.metrics.leftBearing ?? 0) - padding * 1.3;
  const right = Math.max(bounds?.maxX ?? 0, glyph?.metrics.advanceWidth ?? 600, metrics.unitsPerEm * .55) + padding;
  const y = Math.min(bounds?.minY ?? 0, -metrics.ascender) - padding * .55;
  const bottom = Math.max(bounds?.maxY ?? 0, -metrics.descender) + padding * .55;
  return { x, y, width: right - x, height: bottom - y };
}

export function zoomFrame(frame: ReturnType<typeof glyphFrame>, zoom: number) {
  const width = frame.width / zoom;
  const height = frame.height / zoom;
  return { x: frame.x + (frame.width - width) / 2, y: frame.y + (frame.height - height) / 2, width, height };
}

export function unicodeLabel(key: string) {
  const code = key.codePointAt(0);
  return code === undefined ? "" : "U+" + code.toString(16).toUpperCase().padStart(4, "0");
}
