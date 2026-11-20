import paper from "paper";
import { serializePath } from "./svg";
import { point, type BooleanOperation, type Contour, type Segment } from "./types";

function fromPaperPath(path: paper.Path): Contour[] {
  const anchors = path.segments;
  if (!anchors.length) return [];
  const start = point(anchors[0].point.x, anchors[0].point.y);
  const segments: Segment[] = [];
  const edges = path.closed ? anchors.length : anchors.length - 1;
  for (let index = 0; index < edges; index++) {
    const from = anchors[index];
    const next = anchors[(index + 1) % anchors.length];
    const to = point(next.point.x, next.point.y);
    if (from.handleOut.isZero() && next.handleIn.isZero()) {
      if (index + 1 < anchors.length) segments.push({ kind: "line", to });
      continue;
    }
    segments.push({
      kind: "cubic",
      control1: point(from.point.x + from.handleOut.x, from.point.y + from.handleOut.y),
      control2: point(next.point.x + next.handleIn.x, next.point.y + next.handleIn.y),
      to,
    });
  }
  return [{ start, closed: path.closed, segments }];
}

export function booleanPath(operation: BooleanOperation, subject: readonly Contour[], clip: readonly Contour[]): Contour[] {
  if (!subject.length || !clip.length) throw new RangeError("Boolean operations require two nonempty shapes.");
  if ([...subject, ...clip].some(contour => !contour.closed || contour.segments.length === 0)) {
    throw new RangeError("Boolean operations require closed contours.");
  }
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(1, 1));
  try {
    const makeShape = (contours: readonly Contour[]) => new scope.CompoundPath({
      pathData: serializePath(contours),
      insert: false,
      fillRule: "nonzero",
    });
    const first = makeShape(subject);
    const second = makeShape(clip);
    const options = { insert: false };
    const result = operation === "union" ? first.unite(second, options)
      : operation === "subtract" ? first.subtract(second, options)
      : first.intersect(second, options);
    if (result instanceof scope.CompoundPath) {
      return result.children.flatMap(child => child instanceof scope.Path ? fromPaperPath(child) : []);
    }
    return result instanceof scope.Path ? fromPaperPath(result) : [];
  } finally {
    scope.remove();
  }
}
