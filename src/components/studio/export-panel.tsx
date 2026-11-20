"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { exportSlug, toExportRequest, type ExportFormat } from "@/lib/exports/contracts";
import type { StudioSource } from "@/lib/foundry/studio-source";
import type { GlyphFoundryState } from "@/lib/foundry/types";

const choices: { format: ExportFormat; label: string; extension: string }[] = [
  { format: "woff2", label: "WOFF2 webfont", extension: ".woff2" },
  { format: "ttf", label: "TrueType desktop font", extension: ".ttf" },
  { format: "svg", label: "SVG sprite", extension: "-sprite.svg" },
  { format: "react", label: "React icon pack", extension: "-react.zip" },
  { format: "specimen", label: "Specimen image", extension: "-specimen.svg" },
];

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

async function messageFor(response: Response) {
  const data = await response.json().catch(() => ({})) as { message?: string; error?: string };
  if (data.message) return data.message;
  if (response.status === 401) return "Sign in again to export this collection.";
  if (response.status === 413) return "The draft exceeds the 1 MB export limit.";
  if (response.status === 429) return "The request limit was reached. Try again in a minute.";
  return "The export could not be completed. Try again.";
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) return resolve();
    const stop = () => { window.clearTimeout(timer); resolve(); };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
}

async function pollJob(id: string, signal: AbortSignal) {
  const base = "/api/exports/" + id;
  for (let index = 0; index < 60; index++) {
    await wait(index < 4 ? 1500 : 5000, signal);
    if (signal.aborted) return;
    const response = await fetch(base, { signal });
    if (response.status === 429) {
      await wait(60_000, signal);
      continue;
    }
    if (!response.ok) throw Error(await messageFor(response));
    const job = await response.json() as { state: "ready" | "queued" | "failed"; filename?: string; message?: string };
    if (job.state === "ready") return { url: base + "/download", filename: job.filename };
    if (job.state === "failed") throw Error(job.message ?? "Compilation failed.");
  }
  return null;
}

export function ExportPanel({ source, document }: { source: StudioSource; document: GlyphFoundryState }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const running = useRef<AbortController | null>(null);
  const [format, setFormat] = useState<ExportFormat>(source.kind === "typeface" ? "woff2" : "svg");
  const [text, setText] = useState("");
  const [state, setState] = useState<{ message: string; error?: boolean; url?: string; filename?: string }>({ message: "" });
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formats = choices.filter(choice => source.kind === "typeface" || (choice.format !== "ttf" && choice.format !== "woff2"));

  const storageKey = "glyph:export:v1:" + source.ownerId + ":" + source.id;
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored && /^[a-f0-9-]{36}$/i.test(stored)) setJobId(stored);
    } catch {
      // The live export remains available if session storage is disabled.
    }
    return () => running.current?.abort();
  }, [storageKey]);

  function remember(id: string) {
    setJobId(id);
    try { sessionStorage.setItem(storageKey, id); } catch {}
  }

  async function track(id: string, controller: AbortController) {
    setState({ message: "Queued for background compilation." });
    const result = await pollJob(id, controller.signal);
    if (controller.signal.aborted) return;
    if (result) setState({ message: "Export ready. Downloads are available for 24 hours after submission.", ...result });
    else setState({ message: "The job is still queued. Check its status again in a moment." });
  }

  async function checkStatus() {
    if (!jobId || running.current) return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    try {
      await track(jobId, controller);
    } catch (error) {
      if (!controller.signal.aborted) setState({ message: error instanceof Error ? error.message : "The export status is unavailable.", error: true });
    } finally {
      if (running.current === controller) running.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setState({ message: "Preparing your export…" });
    try {
      const response = await fetch("/api/exports", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toExportRequest(source, document, format, text)),
        signal: controller.signal,
      });
      if (!response.ok) throw Error(await messageFor(response));
      if (response.status === 202) {
        const { id } = await response.json() as { id: string };
        remember(id);
        await track(id, controller);
        return;
      }
      const fromHeader = response.headers.get("Content-Disposition")?.match(/filename="([a-z0-9._-]+)"/i)?.[1];
      const fallback = exportSlug(source.name) + choices.find(choice => choice.format === format)!.extension;
      downloadFile(await response.blob(), fromHeader ?? fallback);
      setState({ message: "Download started." });
    } catch (error) {
      if (!controller.signal.aborted) setState(previous => ({
        ...previous, message: error instanceof Error ? error.message : "The export could not be completed.", error: true,
      }));
    } finally {
      if (running.current === controller) running.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <>
    <button onClick={() => dialog.current?.showModal()}>Export</button>
    <dialog className="index-dialog collection-dialog export-dialog" ref={dialog} aria-labelledby="export-title">
      <form onSubmit={submit}>
        <div className="dialog-head">
          <h2 id="export-title">Export {source.kind === "typeface" ? "typeface" : "icon set"}</h2>
          <button type="button" aria-label="Close export" onClick={() => dialog.current?.close()}>×</button>
        </div>
        <label>Format
          <select value={format} disabled={busy} onChange={event => { setFormat(event.target.value as ExportFormat); setState({ message: "" }); }}>
            {formats.map(choice => <option key={choice.format} value={choice.format}>{choice.label}</option>)}
          </select>
        </label>
        {source.kind === "typeface" && (format === "specimen" || format === "react") && <label>Specimen text
          <input disabled={busy} value={text} maxLength={180} onChange={event => setText(event.target.value)} placeholder="Use the current glyph set" />
        </label>}
        {state.message && <p className={state.error ? "form-error" : "export-status"} role={state.error ? "alert" : "status"}>{state.message}</p>}
        <div className="dialog-actions">
          {state.url && !busy && <a className="text-link" href={state.url} download={state.filename}>Download file</a>}
          {jobId && !state.url && !busy && <button className="text-link" type="button" onClick={checkStatus}>Check last export</button>}
          <button className="primary" type="submit" disabled={busy}>{busy ? "Building…" : "Build export"}</button>
        </div>
      </form>
    </dialog>
  </>;
}
