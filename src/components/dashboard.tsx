"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { hc } from "hono/client";
import type { AppType } from "@/server/api";
import { collectionLabels, type Collection, type CollectionKind } from "@/lib/collections";
import { createThumbnail } from "@/lib/thumbnail";
import { Arrow, Brand } from "./marks";

const api = hc<AppType>("").api.collections;
const samples: Collection[] = [
  { id: "forma", name: "Forma Serif", kind: "typeface", thumbnail: null, updatedAt: "" },
  { id: "orbit", name: "Orbit Symbols", kind: "icon_set", thumbnail: null, updatedAt: "" },
  { id: "axial", name: "Axial Grotesk", kind: "typeface", thumbnail: null, updatedAt: "" },
];
type View = "loading" | "guest" | "member" | "error";
type Form = { action: "create" } | { action: "rename" | "delete"; collection: Collection };
type Filter = "all" | CollectionKind;
const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All collections" },
  { value: "typeface", label: "Typefaces" },
  { value: "icon_set", label: "Icon sets" },
];

export function Dashboard() {
  const [view, setView] = useState<View>("loading");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await api.$get({}, { init: { signal: controller.signal } });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setCollections(samples);
          setView("guest");
          return;
        }
        if (!response.ok) throw Error("Collections unavailable");
        const data = await response.json();
        if (controller.signal.aborted) return;
        setCollections(data.collections);
        setView("member");
      } catch {
        if (!controller.signal.aborted) setView("error");
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  const hasPendingPreviews = view === "member" && collections.some(collection => collection.thumbnail === null);
  useEffect(() => {
    if (!hasPendingPreviews) return;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await api.$get({}, { init: { signal: controller.signal } });
        if (!response.ok) return;
        const data = await response.json();
        if (controller.signal.aborted) return;
        const byId = new Map(data.collections.map(collection => [collection.id, collection]));
        setCollections(previous => previous.map(collection => {
          const updated = byId.get(collection.id);
          return updated?.thumbnail && updated.updatedAt === collection.updatedAt ? updated : collection;
        }));
      } catch {
        // Continue showing the local specimen while a background preview is unavailable.
      }
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    const stop = window.setTimeout(() => window.clearInterval(timer), 45000);
    return () => { controller.abort(); window.clearInterval(timer); window.clearTimeout(stop); };
  }, [hasPendingPreviews, collections.length]);

  function show(next: Form) {
    setFeedback("");
    setForm(next);
    dialog.current?.showModal();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || busy) return;
    const values = new FormData(event.currentTarget);
    const name = String(values.get("name") ?? "").trim();
    if (form.action !== "delete" && !name) {
      setFeedback("Enter a collection name.");
      return;
    }
    setBusy(true);
    setFeedback("");
    try {
      if (form.action === "delete") {
        const response = await api[":id"].$delete({ param: { id: form.collection.id } });
        if (!response.ok && response.status !== 404) throw Error("Could not delete");
        setCollections(previous => previous.filter(collection => collection.id !== form.collection.id));
      } else {
        const response = form.action === "create"
          ? await api.$post({ json: { name, kind: values.get("kind") === "icon_set" ? "icon_set" : "typeface" } })
          : await api[":id"].$patch({ param: { id: form.collection.id }, json: { name } });
        if (response.status === 404) {
          if (form.action === "rename") setCollections(previous => previous.filter(item => item.id !== form.collection.id));
          setFeedback("This collection is no longer available.");
          return;
        }
        if (!response.ok) throw Error("Could not save");
        const { collection } = await response.json();
        setCollections(previous => [collection, ...previous.filter(item => item.id !== collection.id)]);
        setFilter("all");
      }
      dialog.current?.close();
    } catch {
      setFeedback("The request could not be completed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const visible = collections.filter(collection => filter === "all" || collection.kind === filter);
  const formTitle = form?.action === "delete" ? "Delete collection" : form?.action === "rename" ? "Rename collection" : "New collection";
  return (
    <div className="shell">
      <header className="mast">
        <div className="wrap mast-inner">
          <Brand />
          <nav aria-label="Main navigation">
            <a href="/" className="back-link"><Arrow back /> Foundry</a>
            {view === "guest" && <a href="/sign-in" className="sign-link">Sign in <Arrow diagonal /></a>}
          </nav>
        </div>
      </header>
      <main className="wrap dashboard">
        <div className="dashboard-heading">
          <div>
            <h1>Collections</h1>
            {view === "guest" && <p>Browse sample collections. Sign in to build your own.</p>}
          </div>
          {view === "member" && <button className="primary" onClick={() => show({ action: "create" })}>New collection <span aria-hidden>+</span></button>}
        </div>
        <div className="collection-toolbar" aria-label="Filter collections" role="group">
          {filters.map(({ value, label }) => <button key={value} aria-pressed={value === filter} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <section className="dashboard-content" aria-label="Collection grid" tabIndex={0}>
          {view === "loading" && <p className="dashboard-message" role="status">Loading collections…</p>}
          {view === "error" && <div className="dashboard-message">
            <p role="alert">Collections are temporarily unavailable.</p>
            <button className="text-link" onClick={() => { setView("loading"); setAttempt(value => value + 1); }}>Try again</button>
          </div>}
          {(view === "member" || view === "guest") && (visible.length ? (
            <ul className="dashboard-grid">
              {visible.map(collection => <li key={collection.id} className="collection-card">
                {/* Generated thumbnails are displayed in image context, which disables SVG script execution. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img loading="lazy" alt="" src={"data:image/svg+xml," + encodeURIComponent(collection.thumbnail ?? createThumbnail(collection))} />
                <div className="card-info">
                  <div><p>{collectionLabels[collection.kind]}</p><h2><a href={"/studio/" + collection.id}>{collection.name}</a></h2></div>
                  {view === "member" && <div className="card-actions">
                    <button onClick={() => show({ action: "rename", collection })} aria-label={"Rename " + collection.name}>Rename</button>
                    <button onClick={() => show({ action: "delete", collection })} aria-label={"Delete " + collection.name}>Delete</button>
                  </div>}
                </div>
              </li>)}
            </ul>
          ) : (
            <div className="dashboard-message">
              <p>{filter === "all" ? "Create a typeface or an icon set to get started." : "No collections match this filter."}</p>
            </div>
          ))}
        </section>
      </main>
      <dialog ref={dialog} className="index-dialog collection-dialog" aria-labelledby="collection-dialog-title"
        onCancel={event => { if (busy) event.preventDefault(); }}
        onClose={() => { setForm(null); setFeedback(""); }}>
        {form && <form onSubmit={submit}>
          <div className="dialog-head">
            <h2 id="collection-dialog-title">{formTitle}</h2>
            <button type="button" disabled={busy} aria-label="Close" onClick={() => dialog.current?.close()}>×</button>
          </div>
          {form.action === "delete" ?
            <p>Delete “{form.collection.name}” and its glyphs and kerning pairs?</p> :
            <label>Name
              <input name="name" required maxLength={80} autoFocus defaultValue={form.action === "rename" ? form.collection.name : ""} />
            </label>}
          {form.action === "create" && <label>Collection type
            <select name="kind"><option value="typeface">Typeface</option><option value="icon_set">Icon set</option></select>
          </label>}
          {feedback && <p className="form-error" role="alert">{feedback}</p>}
          <div className="dialog-actions">
            <button type="button" className="text-link" disabled={busy} autoFocus={form.action === "delete"} onClick={() => dialog.current?.close()}>Cancel</button>
            <button className="primary" disabled={busy} type="submit">{busy ? "Working…" : form.action === "delete" ? "Delete" : "Save collection"}</button>
          </div>
        </form>}
      </dialog>
    </div>
  );
}
