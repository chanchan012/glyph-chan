import { describe, expect, it, vi } from "vitest";
import { createFoundry, recordCommand, replayCommands } from "../../src/lib/foundry/document";
import { createFoundryStore } from "../../src/lib/foundry/store";
import type { CommandEnvelope, FoundryCommand } from "../../src/lib/foundry/types";
import { parsePath, serializePath } from "../../src/lib/vector/svg";
import { point } from "../../src/lib/vector/types";

const baseline = createFoundry("specimen", "typeface");
const timestamp = "2026-11-20T00:00:00.000Z";

function envelope(id: string, command: FoundryCommand, actor: CommandEnvelope["actor"]["kind"] = "human"): CommandEnvelope {
  return { id, command, timestamp, actor: { id: actor + "-test", kind: actor } };
}

const seed = envelope("seed", {
  type: "createGlyph", key: "A",
  contours: parsePath("M0 0 C5 12 10 12 15 0 C10 -12 5 -12 0 0 Z"),
});

describe("deterministic command state", () => {
  it("replays the same human and agent mutations with no ambient IDs or clocks", () => {
    const commands = [
      { ...seed, expectedRevision: 0 },
      { ...envelope("agent-drag", { type: "moveAnchor", key: "A", contour: 0, anchor: 0, to: point(4, 3) }, "agent"), expectedRevision: 1 },
      { ...envelope("metrics", { type: "setGlyphMetrics", key: "A", metrics: { advanceWidth: 450, leftBearing: -10, rightBearing: 22 } }), expectedRevision: 2 },
    ];
    const result = replayCommands(baseline, commands);
    expect(result).toEqual(replayCommands(baseline, structuredClone(commands)));
    expect(result.revision).toBe(3);
    expect(serializePath(result.glyphs.A.contours)).toBe("M 4 3 C 9 15 10 12 15 0 C 10 -12 9 -9 4 3 Z");
    expect(result.glyphs.A.metrics).toEqual({ advanceWidth: 450, leftBearing: -10, rightBearing: 22 });
    expect(baseline.glyphs).toEqual({});
  });

  it("allows supplementary Unicode glyphs and rejects malformed keys", () => {
    expect(recordCommand(baseline, envelope("emoji", { type: "createGlyph", key: "😀" })).state.glyphs["😀"].key).toBe("😀");
    for (const key of ["AB", "\ud800", "\0"]) {
      expect(() => recordCommand(baseline, envelope("bad", { type: "createGlyph", key }))).toThrow(/key/);
    }
    const icons = createFoundry("icons", "icon_set");
    expect(() => recordCommand(icons, envelope("bad", { type: "createGlyph", key: "__proto__" }))).toThrow(/key/);
    expect(recordCommand(icons, envelope("ok", { type: "createGlyph", key: "arrow-left" })).state.glyphs["arrow-left"]).toBeDefined();
  });

  it("preserves unselected contours when applying a boolean operation", () => {
    const paths = parsePath("M0 0 H10 V10 H0 Z M30 0 H40 V10 H30 Z M5 0 H15 V10 H5 Z");
    const original = recordCommand(baseline, envelope("seed", { type: "createGlyph", key: "A", contours: paths })).state;
    const result = recordCommand(original, envelope("merge", {
      type: "applyBoolean", key: "A", operation: "union", subject: [0], clip: [2],
    })).state;
    expect(result.glyphs.A.contours).toHaveLength(2);
    expect(result.glyphs.A.contours[1]).toEqual(paths[1]);
  });
});

describe("Zustand command history", () => {
  it("restores state and attribution in either direction and clears redo after divergent edits", () => {
    const store = createFoundryStore(baseline);
    store.getState().dispatch(seed);
    const before = store.getState().document.glyphs;
    const move = envelope("move", { type: "moveHandle", key: "A", contour: 0, segment: 0, handle: "control2", to: point(8, 7) }, "agent");
    store.getState().dispatch(move);
    const after = store.getState().document.glyphs;
    expect(store.getState().past.at(-1)).toMatchObject({ id: "move", actor: move.actor, timestamp, type: "moveHandle" });
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().document.glyphs).toEqual(before);
    expect(store.getState().document.revision).toBe(3);
    expect(store.getState().redo()).toBe(true);
    expect(store.getState().document.glyphs).toEqual(after);
    expect(store.getState().document.revision).toBe(4);
    store.getState().undo();
    store.getState().dispatch(envelope("delete", { type: "deleteGlyph", key: "A" }));
    expect(store.getState().redo()).toBe(false);
    expect(store.getState().document.glyphs).toEqual({});
  });

  it("keeps state and subscribers unchanged after stale, invalid, and no-op commands", () => {
    const store = createFoundryStore(baseline, 1);
    store.getState().dispatch(seed);
    const notify = vi.fn();
    const unsubscribe = store.subscribe(notify);
    const before = store.getState();
    const move = envelope("move", { type: "moveAnchor", key: "A", contour: 0, anchor: 0, to: point(0, 0) });
    expect(() => store.getState().dispatch({ ...move, expectedRevision: 0 })).toThrow(/stale/);
    expect(store.getState().dispatch(move)).toBe(false);
    expect(() => store.getState().dispatch(envelope("invalid", { type: "deleteContour", key: "A", contour: 1 }))).toThrow();
    expect(store.getState()).toBe(before);
    expect(notify).not.toHaveBeenCalled();
    store.getState().dispatch(envelope("valid", { type: "deleteGlyph", key: "A" }));
    expect(store.getState().past).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
