"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { recordCommand } from "@/lib/foundry/document";
import type { FoundryCommand, GlyphFoundryState } from "@/lib/foundry/types";
import type { PresenceInput, StudioPresence } from "@/lib/foundry/sync-contract";
import { ellipse, rectangle } from "@/lib/vector/primitives";
import { serializePath } from "@/lib/vector/svg";
import { point, type Contour, type Point } from "@/lib/vector/types";
import { glyphFrame, penContour, zoomFrame, type Curve, type Handle, type NodeTarget, type PenNode, type Tool } from "./studio-geometry";

type Gesture = {
  pointer: number;
  key: string;
  revision: number;
  start: Point;
  current: Point;
  clientX: number;
  clientY: number;
  moved: boolean;
} & ({ kind: "node"; target: NodeTarget; origin: Point } | { kind: "pen" | "rectangle" | "ellipse" });
type NodeGesture = Extract<Gesture, { kind: "node" }>;

interface CanvasProps {
  document: GlyphFoundryState;
  glyphKey: string;
  tool: Tool;
  curve: Curve;
  guides: boolean;
  selected: number[];
  commit: (command: FoundryCommand, expectedRevision?: number) => boolean;
  onSelect: (contour: number) => void;
  onAnchor: (anchor: PresenceInput["anchor"]) => void;
  peers: StudioPresence[];
}

function nodeCommand(key: string, target: NodeTarget, to: Point): FoundryCommand {
  return target.type === "anchor"
    ? { type: "moveAnchor", key, contour: target.contour, anchor: target.anchor, to }
    : { type: "moveHandle", key, contour: target.contour, segment: target.segment, handle: target.handle, to };
}

function primitive(gesture: Gesture) {
  if (!gesture.moved || gesture.start.x === gesture.current.x || gesture.start.y === gesture.current.y) return null;
  return gesture.kind === "rectangle" ? rectangle(gesture.start, gesture.current) : ellipse(gesture.start, gesture.current);
}

function position(svg: SVGSVGElement | null, clientX: number, clientY: number) {
  const matrix = svg?.getScreenCTM();
  if (!matrix) return null;
  const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return point(local.x, local.y);
}

function draggedPoint(gesture: NodeGesture) {
  return point(
    gesture.origin.x + gesture.current.x - gesture.start.x,
    gesture.origin.y + gesture.current.y - gesture.start.y,
  );
}

function preview(document: GlyphFoundryState, gesture: NodeGesture) {
  try {
    return recordCommand(document, {
      id: "pointer-preview", timestamp: "1970-01-01T00:00:00.000Z",
      actor: { kind: "human", id: "pointer-preview" },
      command: nodeCommand(gesture.key, gesture.target, draggedPoint(gesture)),
    }).state.glyphs[gesture.key]?.contours;
  } catch {
    return undefined;
  }
}

export function StudioCanvas({ document, glyphKey, tool, curve, guides, selected, commit, onSelect, onAnchor, peers }: CanvasProps) {
  const svg = useRef<SVGSVGElement>(null);
  const active = useRef<Gesture | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [pen, setPen] = useState<PenNode[]>([]);
  const glyph = document.glyphs[glyphKey];
  const [frame, setFrame] = useState(() => glyphFrame(document.metrics, glyph));
  const [zoom, setZoom] = useState(1);
  const view = zoomFrame(frame, zoom);
  const marker = Math.max(view.width, view.height) / 140;
  const outlines = (gesture?.kind === "node" && gesture.moved ? preview(document, gesture) : undefined) ?? glyph?.contours ?? [];
  const draftNodes = gesture?.kind === "pen" ? [...pen, penNode(gesture)] : pen;
  const draft = tool === "pen" ? penContour(draftNodes, curve, false)
    : gesture?.kind === "rectangle" || gesture?.kind === "ellipse" ? primitive(gesture) : null;

  function clearGesture() {
    const pointer = active.current?.pointer;
    active.current = null;
    if (pointer !== undefined && svg.current?.hasPointerCapture(pointer)) svg.current.releasePointerCapture(pointer);
    setGesture(null);
  }

  useEffect(() => {
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || (!active.current && !pen.length)) return;
      clearGesture();
      setPen([]);
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [pen.length]);

  function start(event: PointerEvent<SVGElement>, node?: { target: NodeTarget; origin: Point }) {
    const kind = tool;
    if (event.button !== 0 || !event.isPrimary || active.current || (!node && kind === "node")) return;
    const start = position(svg.current, event.clientX, event.clientY);
    if (!start) return;
    event.stopPropagation();
    if (node) {
      onSelect(node.target.contour);
      onAnchor(node.target.type === "anchor" ? { contour: node.target.contour, index: node.target.anchor } : null);
    } else onAnchor(null);
    const base = {
      pointer: event.pointerId, key: glyphKey, revision: document.revision, start, current: start,
      moved: false, clientX: event.clientX, clientY: event.clientY,
    };
    const next: Gesture = node ? { ...base, ...node, kind: "node" } : { ...base, kind: kind as Exclude<Tool, "node"> };
    svg.current?.setPointerCapture(event.pointerId);
    active.current = next;
    setGesture(next);
  }

  function update(event: PointerEvent<SVGSVGElement>) {
    const previous = active.current;
    if (!previous || previous.pointer !== event.pointerId) return null;
    const current = position(svg.current, event.clientX, event.clientY);
    if (!current) return null;
    const moved = previous.moved || Math.hypot(event.clientX - previous.clientX, event.clientY - previous.clientY) >= 2;
    return { ...previous, current, moved };
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    const next = update(event);
    if (!next) return;
    active.current = next;
    setGesture(next);
  }

  function penNode(value: Gesture): PenNode {
    return { anchor: value.start, tangent: value.moved ? value.current : undefined };
  }

  function append(contour: Contour, expectedRevision?: number) {
    return commit(glyph ? { type: "appendContour", key: glyphKey, contour }
      : { type: "createGlyph", key: glyphKey, contours: [contour] }, expectedRevision);
  }

  function finish(event: PointerEvent<SVGSVGElement>) {
    const value = update(event);
    if (!value) return;
    clearGesture();
    if (value.kind === "node") {
      if (value.moved) commit(nodeCommand(value.key, value.target, draggedPoint(value)), value.revision);
      return;
    }
    if (value.kind === "pen") {
      setPen(previous => [...previous, penNode(value)]);
      return;
    }
    const contour = primitive(value);
    if (contour && append(contour, value.revision)) onSelect(outlines.length);
  }

  function finishPen(closed: boolean) {
    const contour = penContour(pen, curve, closed);
    if (!contour || !append(contour)) return;
    setPen([]);
    onSelect(outlines.length);
  }

  function nudge(event: KeyboardEvent<SVGElement>, target: NodeTarget, from: Point) {
    const direction = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const amount = event.shiftKey ? 10 : 1;
    onSelect(target.contour);
    onAnchor(target.type === "anchor" ? { contour: target.contour, index: target.anchor } : null);
    commit(nodeCommand(glyphKey, target, point(from.x + amount * direction[0], from.y + amount * direction[1])));
  }

  const heights = [
    ["Ascender", -document.metrics.ascender], ["Cap height", -document.metrics.capHeight],
    ["X-height", -document.metrics.xHeight], ["Baseline", 0], ["Descender", -document.metrics.descender],
  ] as const;
  const glyphMetrics = glyph?.metrics ?? { advanceWidth: 600, leftBearing: 50, rightBearing: 50 };
  const bearings = [["LSB", glyphMetrics.leftBearing], ["RSB", glyphMetrics.advanceWidth - glyphMetrics.rightBearing]] as const;

  return <div className="studio-stage">
    <div className="stage-header">
      <span>{glyphKey}</span>
      <div className="stage-actions">
        {tool === "pen" && <>
          <button disabled={pen.length < 2} onClick={() => finishPen(false)}>End open</button>
          <button disabled={pen.length < 2} onClick={() => finishPen(true)}>Close path</button>
          <button disabled={pen.length === 0} onClick={() => { clearGesture(); setPen([]); }}>Cancel path</button>
        </>}
        <button onClick={() => { clearGesture(); setFrame(glyphFrame(document.metrics, glyph)); setZoom(1); }}>Fit</button>
        <button aria-label="Zoom out" disabled={zoom <= .65} onClick={() => setZoom(value => Math.max(.65, value / 1.25))}>−</button>
        <output aria-label="Canvas zoom">{Math.round(zoom * 100)}%</output>
        <button aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value * 1.25))}>+</button>
      </div>
    </div>
    <svg ref={svg} className={"studio-canvas tool-" + tool} aria-label={"Glyph canvas for " + glyphKey}
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      onPointerDown={event => start(event)} onPointerMove={move} onPointerUp={finish}
      onPointerCancel={clearGesture} onLostPointerCapture={clearGesture}>
      {guides && <g className="optical-guides" data-testid="optical-guides" pointerEvents="none">
        {heights.map(([label, y]) => <g key={label} className={y === 0 ? "baseline" : undefined}>
          <line x1={view.x} x2={view.x + view.width} y1={y} y2={y} />
          <text x={view.x + marker * 2} y={y - marker} fontSize={marker * 1.55}>{label}</text>
        </g>)}
        {bearings.map(([label, x]) => <g key={label}>
          <line x1={x} x2={x} y1={view.y} y2={view.y + view.height} />
          <text x={x + marker} y={view.y + view.height - marker * 2} fontSize={marker * 1.55}>{label}</text>
        </g>)}
      </g>}
      <path data-testid="glyph-path" d={serializePath(outlines)} className="glyph-outline" fillRule="nonzero" />
      {tool === "node" && outlines.map((contour, index) => selected.includes(index)
        ? <path className="contour-selection" key={index} d={serializePath([contour])} />
        : null)}
      {tool === "node" && outlines.map((contour, index) => <NodeMarks key={index}
        contour={contour} index={index} marker={marker} selected={selected.includes(index)}
        onStart={start} onNudge={nudge} />)}
      {peers.flatMap(peer => {
        if (peer.glyph !== glyphKey || !peer.anchor) return [];
        const contour = outlines[peer.anchor.contour];
        const point = peer.anchor.index === 0 ? contour?.start : contour?.segments[peer.anchor.index - 1]?.to;
        return point ? [<circle key={peer.clientId} data-testid="peer-anchor"
          className={"presence-anchor presence-" + peer.actor.kind} cx={point.x} cy={point.y} r={marker * 1.8}>
          <title>{peer.actor.label} · anchor {peer.anchor.index + 1}</title>
        </circle>] : [];
      })}
      {draft && <path data-testid="draft-path" d={serializePath([draft])} className="draft-outline" />}
      {tool === "pen" && draftNodes.map((node, index) => <g key={index}>
        {node.tangent && <line className="handle-line" x1={node.anchor.x} y1={node.anchor.y} x2={node.tangent.x} y2={node.tangent.y} />}
        <circle cx={node.anchor.x} cy={node.anchor.y} r={marker} className="pen-anchor"
          onPointerDown={index === 0 && pen.length >= 2 ? event => { event.stopPropagation(); finishPen(true); } : undefined}
          style={{ pointerEvents: index === 0 && pen.length >= 2 ? "auto" : "none" }} />
      </g>)}
    </svg>
    <div className="stage-footer">
      <span>{tool === "pen" ? "Click for a corner. Drag for a curve." : tool === "node" ? "Drag a node or use arrow keys to nudge." : "Drag to draw."}</span>
      <span>{document.metrics.unitsPerEm} UPM</span>
    </div>
  </div>;
}

function NodeMarks({ contour, index, marker, selected, onStart, onNudge }: {
  contour: Contour; index: number; marker: number; selected: boolean;
  onStart: (event: PointerEvent<SVGElement>, node: { target: NodeTarget; origin: Point }) => void;
  onNudge: (event: KeyboardEvent<SVGElement>, target: NodeTarget, from: Point) => void;
}) {
  const points = [contour.start, ...contour.segments.map(segment => segment.to)];
  const last = points.at(-1);
  const anchors = contour.closed && points.length > 1 && last?.x === contour.start.x && last.y === contour.start.y
    ? points.slice(0, -1) : points;

  function handle(segment: number, key: Handle, from: Point, to: Point) {
    const target: NodeTarget = { type: "handle", contour: index, segment, handle: key };
    return <g key={key}>
      <line className="handle-line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      <circle tabIndex={0} role="button" aria-label={`Contour ${index + 1}, segment ${segment + 1}, ${key} handle`}
        data-testid={`handle-${index}-${segment}-${key}`} className="control-node" cx={to.x} cy={to.y} r={marker * .85}
        onPointerDown={event => onStart(event, { target, origin: to })} onKeyDown={event => onNudge(event, target, to)} />
    </g>;
  }
  return <g>
    {selected && contour.segments.map((segment, position) => <g key={position}>
      {segment.kind === "quadratic" && handle(position, "control", points[position], segment.control)}
      {segment.kind === "cubic" && <>
        {handle(position, "control1", points[position], segment.control1)}
        {handle(position, "control2", segment.to, segment.control2)}
      </>}
    </g>)}
    {anchors.map((anchor, position) => {
      const target: NodeTarget = { type: "anchor", contour: index, anchor: position };
      return <circle tabIndex={0} role="button" key={position}
        aria-label={`Contour ${index + 1}, anchor ${position + 1}`}
        data-testid={`anchor-${index}-${position}`} className="anchor-node"
        cx={anchor.x} cy={anchor.y} r={marker}
        onPointerDown={event => onStart(event, { target, origin: anchor })} onKeyDown={event => onNudge(event, target, anchor)} />;
    })}
  </g>;
}
