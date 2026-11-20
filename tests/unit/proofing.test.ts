import { describe, expect, it } from "vitest";
import { createFoundry, recordCommand } from "../../src/lib/foundry/document";
import { createFoundryStore } from "../../src/lib/foundry/store";
import { auditOpticalConsistency, measureStemWidths } from "../../src/lib/foundry/optics";
import { decodeStudioDraft, encodeStudioDraft, guestStudio, studioDocument } from "../../src/lib/foundry/studio-source";
import { layoutText } from "../../src/lib/foundry/text-layout";
import type { FoundryCommand, GlyphFoundryState } from "../../src/lib/foundry/types";
import { ellipse } from "../../src/lib/vector/primitives";
import { parsePath } from "../../src/lib/vector/svg";
import { point } from "../../src/lib/vector/types";

function command(input: FoundryCommand) {
  return { id: input.type, actor: { id: "tester", kind: "human" as const }, timestamp: "2026-11-20T00:00:00.000Z", command: input };
}

function apply(document: GlyphFoundryState, input: FoundryCommand) {
  return recordCommand(document, command(input)).state;
}

const sample = studioDocument(guestStudio("demo")!);

describe("kerning and waterfall placement", () => {
  it("applies a signed pair adjustment in font units and supports a transient preview", () => {
    const base = layoutText(sample, "AV", { kerning: false })[0];
    const kerned = layoutText(sample, "AV")[0];
    const draft = layoutText(sample, "AV", { draftPair: { left: "A", right: "V", adjustment: 24 } })[0];
    expect(kerned.glyphs[1].x - base.glyphs[1].x).toBe(-52);
    expect(kerned.advanceWidth).toBe(base.advanceWidth - 52);
    expect(draft.glyphs[1].x - base.glyphs[1].x).toBe(24);
    expect(layoutText(sample, "VA")[0].glyphs[1].adjustment).toBe(0);
    expect(sample.kerning).toEqual([{ left: "A", right: "V", adjustment: -52 }]);
  });

  it("normalizes Unicode, preserves explicit spacing, and measures negative bearings", () => {
    const document = apply(sample, {
      type: "createGlyph", key: "é", contours: parsePath("M100 -20 H120 V5 H100 Z"),
      metrics: { advanceWidth: 110, leftBearing: -10, rightBearing: 100 },
    });
    const [first, second] = layoutText(document, "e\u0301 🚀\r\nV");
    expect(first.glyphs.map(glyph => [glyph.key, glyph.missing])).toEqual([["é", false], [" ", false], ["🚀", true]]);
    expect(first.glyphs[0].x).toBe(-110);
    expect(first.bounds.minX).toBe(-10);
    expect(first.advanceWidth).toBe(110 + 330 + 600);
    expect(second.glyphs[0].adjustment).toBe(0);
  });

  it("supports undo, redo, deletion, and local draft recovery", () => {
    const store = createFoundryStore(sample);
    store.getState().dispatch(command({ type: "setKerningPair", left: "A", right: "V", adjustment: -80 }));
    expect(store.getState().document.kerning[0].adjustment).toBe(-80);
    store.getState().undo();
    expect(store.getState().document.kerning[0].adjustment).toBe(-52);
    store.getState().redo();
    const saved = encodeStudioDraft(store.getState().document);
    expect(decodeStudioDraft(guestStudio("demo")!, saved).kerning[0].adjustment).toBe(-80);
    expect(apply(store.getState().document, { type: "deleteGlyph", key: "A" }).kerning).toEqual([]);
    expect(apply(sample, { type: "setKerningPair", left: "A", right: "V", adjustment: 0 }).kerning).toEqual([]);
  });

  it("accepts old browser drafts and rejects unknown glyphs and invalid adjustments", () => {
    const source = guestStudio("demo")!;
    const legacy = JSON.stringify({ metrics: source.metrics, glyphs: source.glyphs.slice(0, 3) });
    const upgraded = decodeStudioDraft(source, legacy);
    expect(upgraded.glyphs.a).toEqual(sample.glyphs.a);
    expect(upgraded.kerning).toEqual(sample.kerning);
    expect(() => apply(sample, { type: "setKerningPair", left: "A", right: "Q", adjustment: 100 })).toThrow(/does not exist/);
    expect(() => apply(sample, { type: "setKerningPair", left: "A", right: "V", adjustment: 2.5 })).toThrow(/Invalid kerning/);
  });
});

describe("optical stroke analysis", () => {
  it("measures strokes through counters with nonzero winding", () => {
    const ring = parsePath("M0 0 H300 V400 H0 Z M38 26 V374 H262 V26 Z");
    expect(measureStemWidths(ring)).toMatchObject({ vertical: 38, horizontal: 26 });
    const solid = parsePath("M0 0 H300 V400 H0 Z M38 26 H262 V374 H38 Z");
    expect(measureStemWidths(solid)).toMatchObject({ vertical: 300, horizontal: 400 });
  });

  it("measures curved fill, ignores open contours, and identifies overshoot and stem outliers", () => {
    const curved = ellipse(point(0, -500), point(200, 0));
    const measured = measureStemWidths([curved, ...parsePath("M-900 -1000 L900 1000")]);
    expect(measured.vertical).toBeGreaterThan(180);
    expect(measured.vertical).toBeLessThan(200);
    expect(measureStemWidths(parsePath("M0 0 L20 20")).vertical).toBeNull();
    let document = createFoundry("audit", "typeface");
    document = apply(document, { type: "createGlyph", key: "i", contours: parsePath("M0 -500 H50 V0 H0 Z") });
    document = apply(document, { type: "createGlyph", key: "O", contours: parsePath("M0 -720 H95 V18 H0 Z") });
    document = apply(document, { type: "createGlyph", key: "g", contours: parsePath("M0 -492 H52 V211 H0 Z") });
    const result = auditOpticalConsistency(document, { stemTarget: 52, stemTolerance: 10, overshootTolerance: 15 });
    expect(result.rows.find(row => row.key === "O")).toMatchObject({
      vertical: 95, stemOutsideTolerance: true,
      overshoot: { top: 20, bottom: 18, topGuide: "capHeight", bottomGuide: "baseline", outsideTolerance: true },
    });
    expect(result.rows.find(row => row.key === "g")).toMatchObject({
      vertical: 52, stemOutsideTolerance: false,
      overshoot: { top: -8, bottom: 11, topGuide: "xHeight", bottomGuide: "descender", outsideTolerance: false },
    });
  });
});
