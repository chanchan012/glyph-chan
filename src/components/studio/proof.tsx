"use client";

import { useMemo, useState, type FormEvent } from "react";
import { auditOpticalConsistency } from "@/lib/foundry/optics";
import { layoutText, type TextLine } from "@/lib/foundry/text-layout";
import type { FoundryCommand, GlyphFoundryState, KerningPair } from "@/lib/foundry/types";
import { serializePath } from "@/lib/vector/svg";

const sizes = [16, 24, 36, 54, 80];
const format = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const signed = (value: number) => value > 0 ? "+" + format.format(value) : format.format(value);
const showKey = (key: string) => key === " " ? "Space" : key;
type Commit = (command: FoundryCommand) => boolean;

function WaterfallRow({ document, lines, size, label }: {
  document: GlyphFoundryState; lines: TextLine[]; size: number; label: string;
}) {
  const { unitsPerEm, ascender, descender, capHeight } = document.metrics;
  const scale = size / unitsPerEm;
  const left = Math.min(0, ...lines.map(line => line.bounds.minX)) - unitsPerEm * .06;
  const right = Math.max(unitsPerEm * .5, ...lines.map(line => line.bounds.maxX)) + unitsPerEm * .06;
  const lineStep = Math.max(unitsPerEm, ascender - descender) * 1.2;
  const top = Math.min(-ascender, ...lines.map((line, index) => line.bounds.minY + index * lineStep));
  const bottom = Math.max(-descender, ...lines.map((line, index) => line.bounds.maxY + index * lineStep));
  return <svg className="proof-line" role="img" aria-label={label} data-size={size}
    width={Math.ceil((right - left) * scale)} height={Math.ceil((bottom - top) * scale)}
    viewBox={`${left} ${top} ${right - left} ${bottom - top}`}>
    {lines.map((line, row) => <g key={row} transform={`translate(0 ${row * lineStep})`}>
      {line.glyphs.map(({ glyph, x, advanceWidth, adjustment, missing, key }, index) =>
        <g key={index} transform={`translate(${x} 0)`} data-proof-glyph={key} data-adjustment={adjustment}>
          {glyph?.contours.length ? <path d={serializePath(glyph.contours)} fill="currentColor" fillRule="nonzero" />
            : missing ? <rect x={advanceWidth * .12} y={-capHeight * .9} width={advanceWidth * .68} height={capHeight * .9}
              fill="none" stroke="currentColor" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            : null}
        </g>)}
    </g>)}
  </svg>;
}

function OpticalAudit({ document }: { document: GlyphFoundryState }) {
  const [target, setTarget] = useState("");
  const [tolerance, setTolerance] = useState("");
  const targetNumber = Number(target);
  const toleranceNumber = Number(tolerance);
  const results = useMemo(() => auditOpticalConsistency(document, {
    stemTarget: targetNumber > 0 ? targetNumber : undefined,
    overshootTolerance: tolerance !== "" && toleranceNumber >= 0 ? toleranceNumber : undefined,
  }), [document, targetNumber, tolerance, toleranceNumber]);
  return <div className="proof-audit">
    <h3>Optical audit</h3>
    <p>Measurements use closed outlines and are reported in font units.</p>
    <div className="proof-fields proof-audit-fields">
      <label>Stem target
        <input type="number" min={1} max={65535} value={target}
          placeholder={results.stemReference !== null && target === "" ? format.format(results.stemReference) : "Auto"}
          onChange={event => setTarget(event.target.value)} />
      </label>
      <label>Overshoot tolerance
        <input type="number" min={0} max={32767} value={tolerance} placeholder={String(Math.round(document.metrics.unitsPerEm * .025))}
          onChange={event => setTolerance(event.target.value)} />
      </label>
    </div>
    <p>Stem tolerance {format.format(results.stemTolerance)} units</p>
    {results.rows.length ? <table className="audit-table">
      <caption className="sr-only">Stem widths and optical guide deviations by glyph</caption>
      <thead><tr><th scope="col">Glyph</th><th scope="col">Stem x / y</th><th scope="col">Top / base</th></tr></thead>
      <tbody>{results.rows.map(row => <tr key={row.key}>
        <th scope="row">{showKey(row.key)}</th>
        <td data-outlier={row.stemOutsideTolerance}>
          {row.vertical === null ? "—" : format.format(row.vertical)} / {row.horizontal === null ? "—" : format.format(row.horizontal)}
          {row.stemOutsideTolerance && <small>Review stem</small>}
        </td>
        <td data-outlier={row.overshoot?.outsideTolerance ?? false}>
          {row.overshoot ? <><span title={row.overshoot.topGuide + " / " + row.overshoot.bottomGuide}>
            {signed(row.overshoot.top)} / {signed(row.overshoot.bottom)}
          </span>{row.overshoot.outsideTolerance && <small>Review guide</small>}</> : "—"}
        </td>
      </tr>)}</tbody>
    </table> : <p>Draw glyphs to measure their outlines.</p>}
  </div>;
}

function validAdjustment(value: string) {
  if (!/^[+-]?\d+$/.test(value.trim())) return null;
  const units = Number(value);
  return Number.isInteger(units) && units >= -32768 && units <= 32767 ? units : null;
}

export function ProofWorkspace({ document, active, commit }: {
  document: GlyphFoundryState; active: boolean; commit: Commit;
}) {
  const glyphKeys = Object.keys(document.glyphs).sort();
  const first = document.kerning[0];
  const [text, setText] = useState(() => document.glyphs.A && document.glyphs.V
    ? (document.glyphs.a && document.glyphs.r && document.glyphs.e ? "AV area" : "AV")
    : (Object.keys(document.glyphs).slice(0, 20).join("") || "AV"));
  const [enabled, setEnabled] = useState(true);
  const [tab, setTab] = useState<"kerning" | "audit">("kerning");
  const [pane, setPane] = useState<"waterfall" | "details">("waterfall");
  const [left, setLeft] = useState(first?.left ?? glyphKeys[0] ?? "");
  const [right, setRight] = useState(first?.right ?? glyphKeys[1] ?? glyphKeys[0] ?? "");
  const [edit, setEdit] = useState<string | null>(null);
  const effectiveLeft = glyphKeys.includes(left) ? left : glyphKeys[0] ?? "";
  const effectiveRight = glyphKeys.includes(right) ? right : glyphKeys[1] ?? glyphKeys[0] ?? "";
  const pair = document.kerning.find(pair => pair.left === effectiveLeft && pair.right === effectiveRight);
  const adjustment = edit ?? String(pair?.adjustment ?? 0);
  const units = validAdjustment(adjustment);
  const usablePair = Boolean(effectiveLeft && effectiveRight);
  const draft: KerningPair | undefined = usablePair && units !== null && edit !== null
    ? { left: effectiveLeft, right: effectiveRight, adjustment: units } : undefined;
  const lines = active ? layoutText(document, text, { kerning: enabled, draftPair: draft }) : [];
  const pairPreview = active && usablePair && tab === "kerning"
    ? layoutText(document, effectiveLeft + effectiveRight, { kerning: enabled, draftPair: draft }) : [];
  if (!active) return null;

  function choosePair(pair: KerningPair) {
    setLeft(pair.left);
    setRight(pair.right);
    setEdit(null);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (units === null || !usablePair) return;
    commit({ type: "setKerningPair", left: effectiveLeft, right: effectiveRight, adjustment: units });
    setEdit(null);
  }

  return <main className="proof-workspace" data-proof-pane={pane} aria-label="Typeface proofing">
    <div className="proof-mobile-tabs" role="group" aria-label="Proof panel">
      <button aria-pressed={pane === "waterfall"} onClick={() => setPane("waterfall")}>Waterfall</button>
      <button aria-pressed={pane === "details"} onClick={() => setPane("details")}>Proof inspector</button>
    </div>
    <section className="proof-waterfall" aria-labelledby="proof-title">
      <div className="proof-heading">
        <h2 id="proof-title">Waterfall</h2>
        <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Show kerning</label>
      </div>
      <label className="proof-input">Specimen text
        <textarea maxLength={180} rows={2} value={text} onChange={event => setText(event.target.value)}
          placeholder="Type a word or sentence" />
      </label>
      <div className="waterfall-rows" tabIndex={0} aria-label="Specimen waterfall">
        {sizes.map(size => <section key={size} className="waterfall-row" aria-label={size + " pixel specimen"}>
          <h3>{size} px</h3>
          <div className="waterfall-outline" tabIndex={0}>
            <WaterfallRow document={document} lines={lines} size={size} label={`Specimen at ${size} pixels`} />
          </div>
        </section>)}
      </div>
    </section>
    <aside className="proof-inspector" aria-label="Proof inspector">
      <div className="proof-inspector-tabs" role="group" aria-label="Proof tools">
        <button aria-pressed={tab === "kerning"} onClick={() => setTab("kerning")}>Kerning</button>
        <button aria-pressed={tab === "audit"} onClick={() => setTab("audit")}>Optical audit</button>
      </div>
      {tab === "audit" ? <OpticalAudit document={document} /> :
        <div className="kerning-editor">
          <h3>Kerning pairs</h3>
          {!usablePair ? <p>Create glyphs in the editor to add a pair.</p> : <>
            <div className="kerning-preview">
              <WaterfallRow document={document} lines={pairPreview} size={76} label="Selected kerning pair" />
            </div>
            <form onSubmit={save} className="kerning-form">
              <div className="proof-fields">
                <label>Left glyph
                  <select value={effectiveLeft} onChange={event => { setLeft(event.target.value); setEdit(null); }}>
                    {glyphKeys.map(key => <option key={key} value={key}>{showKey(key)}</option>)}
                  </select>
                </label>
                <label>Right glyph
                  <select value={effectiveRight} onChange={event => { setRight(event.target.value); setEdit(null); }}>
                    {glyphKeys.map(key => <option key={key} value={key}>{showKey(key)}</option>)}
                  </select>
                </label>
              </div>
              <label className="kerning-adjustment">Adjustment in units
                <input type="number" min={-32768} max={32767} step={1} required
                  value={adjustment} onChange={event => setEdit(event.target.value)} />
              </label>
              <div className="kerning-actions">
                <button className="panel-button" type="submit" disabled={units === null || units === (pair?.adjustment ?? 0)}>Save pair</button>
                {pair && <button className="text-link" type="button" onClick={() => {
                  commit({ type: "setKerningPair", left: effectiveLeft, right: effectiveRight, adjustment: 0 });
                  setEdit(null);
                }}>Remove pair</button>}
              </div>
            </form>
          </>}
          {document.kerning.length > 0 && <ul className="kerning-list" aria-label="Saved kerning pairs">
            {document.kerning.map(pair => <li key={pair.left + pair.right}>
              <button aria-pressed={pair.left === effectiveLeft && pair.right === effectiveRight} onClick={() => choosePair(pair)}>
                <span>{showKey(pair.left)} {showKey(pair.right)}</span>
                <span>{signed(pair.adjustment)}</span>
              </button>
            </li>)}
          </ul>}
        </div>}
    </aside>
  </main>;
}
