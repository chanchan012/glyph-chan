import { useState, type FormEvent } from "react";
import type { FoundryCommand, FoundryMetrics, Glyph, GlyphFoundryState, GlyphMetrics } from "@/lib/foundry/types";
import { pathBounds } from "@/lib/vector/bezier";
import { parsePath, serializePath } from "@/lib/vector/svg";
import { unicodeLabel } from "./studio-geometry";

const alphabet = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
const glyphFields = [
  ["advanceWidth", "Advance width", 0, 65535], ["leftBearing", "Left sidebearing", -32768, 32767],
  ["rightBearing", "Right sidebearing", -32768, 32767],
] as const;
const defaultGlyphMetrics = { advanceWidth: 600, leftBearing: 50, rightBearing: 50 };
const foundryFields = [
  ["unitsPerEm", "Units per em", 16, 16384], ["ascender", "Ascender", 1, 32767],
  ["capHeight", "Cap height", 1, 32767], ["xHeight", "X-height", 1, 32767],
  ["descender", "Descender", -32768, 0],
] as const;

function GlyphTile({ glyph, glyphKey, isSelected, choose }: {
  glyph?: Glyph; glyphKey: string; isSelected: boolean; choose: () => void;
}) {
  const bounds = pathBounds(glyph?.contours ?? []);
  const pad = bounds ? Math.max(4, Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * .10) : 0;
  return <button className="glyph-tile" aria-label={"Select glyph " + glyphKey} aria-pressed={isSelected} onClick={choose}
    data-empty={glyph ? undefined : "true"}>
    {bounds ? <svg aria-hidden="true" viewBox={`${bounds.minX - pad} ${bounds.minY - pad} ${bounds.maxX - bounds.minX + pad * 2} ${bounds.maxY - bounds.minY + pad * 2}`}>
      <path d={serializePath(glyph!.contours)} fill="currentColor" />
    </svg> : <span aria-hidden="true">{glyphKey}</span>}
    <small>{glyphKey}</small>
  </button>;
}

export function GlyphPanel({ document, glyphKey, choose, create }: {
  document: GlyphFoundryState; glyphKey: string; choose: (key: string) => void; create: (key: string) => boolean;
}) {
  const [input, setInput] = useState("");
  const existing = Object.keys(document.glyphs).sort();
  const empty = (document.kind === "typeface" ? alphabet : [glyphKey]).filter(key => !Object.hasOwn(document.glyphs, key));
  return <div className="studio-panel">
    <div className="panel-title"><h2>Glyphs</h2><span>{Object.keys(document.glyphs).length}</span></div>
    <form className="glyph-add" onSubmit={event => {
      event.preventDefault();
      const trimmed = input.trim();
      const key = input === " " && document.kind === "typeface" ? input : trimmed;
      if (key && create(key)) setInput("");
    }}>
      <input aria-label="New glyph key" placeholder={document.kind === "typeface" ? "Character" : "Icon name"}
        maxLength={80} value={input} onChange={event => setInput(event.target.value)} />
      <button type="submit" disabled={!input} aria-label="Add glyph">+</button>
    </form>
    <div className="glyph-matrix" aria-label="Glyph matrix">
      {[...existing, ...empty].map(key => <GlyphTile key={key} glyph={document.glyphs[key]} glyphKey={key}
        isSelected={key === glyphKey} choose={() => choose(key)} />)}
    </div>
  </div>;
}

const readNumber = (values: FormData, key: string) => Number(values.get(key));

export function MetricsPanel({ document, glyphKey, selected, toggleContour, commit, report }: {
  document: GlyphFoundryState; glyphKey: string; selected: number[];
  toggleContour: (index: number) => void; commit: (command: FoundryCommand) => boolean; report: (message: string) => void;
}) {
  const glyph = document.glyphs[glyphKey];
  const metrics = glyph?.metrics ?? defaultGlyphMetrics;
  const path = serializePath(glyph?.contours ?? []);
  const activeContours = selected.filter(index => index < (glyph?.contours.length ?? 0));
  const canCombine = activeContours.length >= 2 && activeContours.every(index => glyph?.contours[index].closed);

  function applyGlyph(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const metrics = Object.fromEntries(glyphFields.map(([key]) => [key, readNumber(values, key)])) as unknown as GlyphMetrics;
    commit(glyph ? { type: "setGlyphMetrics", key: glyphKey, metrics } : { type: "createGlyph", key: glyphKey, metrics });
  }

  function applyFoundry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const metrics = Object.fromEntries(foundryFields.map(([key]) => [key, readNumber(values, key)])) as unknown as FoundryMetrics;
    commit({ type: "setFoundryMetrics", metrics });
  }

  function applyPath(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      const contours = parsePath(String(values.get("outline") ?? ""));
      commit(glyph ? { type: "replaceContours", key: glyphKey, contours } : { type: "createGlyph", key: glyphKey, contours });
    } catch (error) {
      report(error instanceof Error ? error.message : "Invalid path data.");
    }
  }

  return <div className="studio-panel metrics-panel">
    <div className="panel-title"><h2>Inspector</h2><span>{document.kind === "typeface" ? unicodeLabel(glyphKey) : glyphKey}</span></div>
    <section className="inspector-section">
      <h3>Glyph metrics</h3>
      <form key={glyphKey + Object.values(metrics).join(",")} onSubmit={applyGlyph}>
        {glyphFields.map(([name, label, min, max]) => <label className="metric-field" key={name}>
          {label}<input type="number" name={name} min={min} max={max} step={1} required defaultValue={metrics[name]} />
        </label>)}
        <button className="panel-button" type="submit">Apply glyph metrics</button>
      </form>
    </section>
    <section className="inspector-section">
      <h3>Contours</h3>
      {!glyph?.contours.length && <p>Draw a contour or paste SVG path data.</p>}
      {!!glyph?.contours.length && <>
        <div className="contour-list">
          {glyph.contours.map((contour, index) => <label key={index}>
            <input type="checkbox" checked={activeContours.includes(index)} onChange={() => toggleContour(index)} />
            <span>Contour {index + 1}</span><small>{contour.closed ? "Closed" : "Open"}</small>
          </label>)}
        </div>
        <div className="boolean-actions">
          {(["union", "subtract", "intersect"] as const).map(operation => <button className="panel-button" key={operation} disabled={!canCombine}
            onClick={() => commit({ type: "applyBoolean", key: glyphKey, operation, subject: activeContours.slice(0, 1), clip: activeContours.slice(1) })}>
            {operation[0].toUpperCase() + operation.slice(1)}
          </button>)}
        </div>
        {activeContours.length === 1 && <button className="text-link" onClick={() => commit({ type: "deleteContour", key: glyphKey, contour: activeContours[0] })}>Remove contour</button>}
        {activeContours.length > 1 && <p>Subtraction uses the first selected contour as its base.</p>}
      </>}
    </section>
    <details className="inspector-section">
      <summary>Optical guide metrics</summary>
      <form key={Object.values(document.metrics).join(",")} onSubmit={applyFoundry}>
        {foundryFields.map(([name, label, min, max]) => <label className="metric-field" key={name}>
          {label}<input type="number" name={name} min={min} max={max} step={1} required defaultValue={document.metrics[name]} />
        </label>)}
        <button className="panel-button" type="submit">Apply guide metrics</button>
      </form>
    </details>
    <details className="inspector-section">
      <summary>SVG path data</summary>
      <form key={glyphKey + path} onSubmit={applyPath}>
        <textarea name="outline" rows={5} maxLength={500000} defaultValue={path} aria-label="SVG path data" spellCheck={false} />
        <button className="panel-button" type="submit">Replace outline</button>
      </form>
    </details>
  </div>;
}
