"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { createFoundryStore } from "@/lib/foundry/store";
import type { FoundryCommand } from "@/lib/foundry/types";
import { commandEnvelope, decodeStudioDraft, encodeStudioDraft, studioDocument, studioDraftKey, type StudioSource } from "@/lib/foundry/studio-source";
import { Arrow, Brand } from "../marks";
import { StudioCanvas } from "./canvas";
import { GlyphPanel, MetricsPanel } from "./panels";
import { ProofWorkspace } from "./proof";
import type { Curve, Tool } from "./studio-geometry";

const tools: { value: Tool; label: string }[] = [
  { value: "node", label: "Node" }, { value: "pen", label: "Pen" },
  { value: "rectangle", label: "Rectangle" }, { value: "ellipse", label: "Ellipse" },
];
const panes = [["glyphs", "Glyphs"], ["canvas", "Canvas"], ["metrics", "Inspector"]] as const;

export function Studio({ source }: { source: StudioSource }) {
  const [store] = useState(() => createFoundryStore(studioDocument(source)));
  const document = useStore(store, value => value.document);
  const canUndo = useStore(store, value => value.past.length > 0);
  const canRedo = useStore(store, value => value.future.length > 0);
  const [glyphKey, setGlyphKey] = useState(source.glyphs[0]?.key ?? (source.kind === "typeface" ? "A" : "icon"));
  const [selection, setSelection] = useState<number[]>([0]);
  const [tool, setTool] = useState<Tool>("node");
  const [curve, setCurve] = useState<Curve>("cubic");
  const [guides, setGuides] = useState(true);
  const [pane, setPane] = useState<(typeof panes)[number][0]>("canvas");
  const [proof, setProof] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [storage, setStorage] = useState<"original" | "local" | "session">("original");
  const [ready, setReady] = useState(false);
  const count = document.glyphs[glyphKey]?.contours.length ?? 0;

  useEffect(() => {
    const key = studioDraftKey(source);
    try {
      const draft = localStorage.getItem(key);
      if (draft) {
        try {
          store.setState({ document: decodeStudioDraft(source, draft) });
          setStorage("local");
        } catch {
          setFeedback("The local draft could not be opened. Showing the original collection.");
        }
      }
    } catch {
      setStorage("session");
    }
    setReady(true);
    return store.subscribe((next, previous) => {
      if (next.document === previous.document) return;
      try {
        localStorage.setItem(key, encodeStudioDraft(next.document));
        setStorage("local");
      } catch {
        setStorage("session");
      }
    });
  }, [source, store]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable)) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      event.preventDefault();
      const state = store.getState();
      if (key === "y" || event.shiftKey) state.redo();
      else state.undo();
      setFeedback("");
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [store]);

  function choose(key: string) {
    setGlyphKey(key);
    setSelection([0]);
    setFeedback("");
    setPane("canvas");
  }

  function commit(command: FoundryCommand, expectedRevision?: number) {
    try {
      const changed = store.getState().dispatch(commandEnvelope(source.ownerId, command, expectedRevision));
      setFeedback("");
      if (command.type === "applyBoolean" || command.type === "replaceContours" || command.type === "deleteContour") setSelection([0]);
      return changed;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The edit could not be applied.");
      return false;
    }
  }

  function create(key: string) {
    if (!Object.hasOwn(store.getState().document.glyphs, key) && !commit({ type: "createGlyph", key })) return false;
    choose(key);
    return true;
  }

  return <div className="shell studio-shell" data-ready={ready}>
    <header className="studio-top">
      <div className="studio-identity">
        <Brand />
        <span aria-hidden="true">/</span>
        <h1 title={source.name}>{source.name}</h1>
      </div>
      <a href="/dashboard" className="back-link"><Arrow back /> Collections</a>
    </header>
    <div className="studio-toolbar" role="group" aria-label="Studio tools">
      {!proof && <div className="tool-group">
        {tools.map(({ value, label }) => <button key={value} aria-pressed={tool === value} onClick={() => setTool(value)}>{label}</button>)}
      </div>}
      {!proof && tool === "pen" && <label className="curve-select"><span>Curve</span>
        <select aria-label="Curve type" value={curve} onChange={event => setCurve(event.target.value as Curve)}>
          <option value="cubic">Cubic</option><option value="quadratic">Quadratic</option><option value="line">Line</option>
        </select>
      </label>}
      <div className="tool-group tool-history">
        <button onClick={() => { store.getState().undo(); setFeedback(""); }} disabled={!canUndo}>Undo</button>
        <button onClick={() => { store.getState().redo(); setFeedback(""); }} disabled={!canRedo}>Redo</button>
        {!proof && <button aria-pressed={guides} onClick={() => setGuides(value => !value)}>Guides</button>}
        {source.kind === "typeface" && <button aria-pressed={proof} onClick={() => setProof(value => !value)}>Specimen</button>}
      </div>
    </div>
    <div className="studio-tabs" role="group" aria-label="Studio panel" hidden={proof}>
      {panes.map(([value, label]) => <button key={value} aria-pressed={pane === value} onClick={() => setPane(value)}>{label}</button>)}
    </div>
    <main className="studio-workspace" data-pane={pane} hidden={proof}>
      <aside className="studio-rail rail-glyphs" aria-label="Glyph browser">
        <GlyphPanel document={document} glyphKey={glyphKey} choose={choose} create={create} />
      </aside>
      <section className="studio-center" aria-label="Vector editor">
        <StudioCanvas key={glyphKey + ":" + tool + ":" + curve} document={document} glyphKey={glyphKey}
          selected={selection.filter(index => index < count)} tool={tool} curve={curve} guides={guides} commit={commit}
          onSelect={index => setSelection([index])} />
      </section>
      <aside className="studio-rail rail-metrics" aria-label="Glyph inspector">
        <MetricsPanel document={document} glyphKey={glyphKey} selected={selection} commit={commit}
          report={setFeedback} toggleContour={index => setSelection(previous => previous.includes(index)
            ? previous.filter(value => value !== index) : [...previous.filter(value => value < count), index])} />
      </aside>
    </main>
    {source.kind === "typeface" && <ProofWorkspace document={document} active={proof} commit={commit} />}
    <footer className="studio-status">
      {feedback ? <p role="alert">{feedback}</p> : <span>{source.ownerId === "guest" ? "Guest draft" : "Collection draft"}</span>}
      <span>{storage === "local" ? "Saved on this device" : storage === "session" ? "Session only" : "Edits stay on this device"}</span>
    </footer>
  </div>;
}
