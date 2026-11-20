import { useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand";
import type { FoundryStore } from "@/lib/foundry/store";
import { decodeStudioDraft, snapshotDocument, studioDocument, studioDraftKey, type StudioSource } from "@/lib/foundry/studio-source";
import { mergeStudioSnapshots, sameSnapshot } from "@/lib/foundry/snapshot-merge";
import { revisionSchema, saveStudioSchema, snapshotSchema, studioSnapshot, type PresenceInput,
  type StudioPresence, type StudioSave, type StudioSnapshot } from "@/lib/foundry/sync-contract";

type Checkpoint = { revision: number; snapshot: StudioSnapshot };
type Conflict = { base: StudioSnapshot | null; remote: Checkpoint; labels: string[] };
type Choice = "local" | "remote";
type SyncState = "original" | "local" | "session" | "connecting" | "synced" | "saving" | "retry" | "conflict" | "error";
type SaveResponse = { state: "saved" | "conflict"; studio: StudioSource };

const labels: Record<SyncState, string> = {
  original: "Edits stay on this device", local: "Saved on this device", session: "Session only",
  connecting: "Connecting to shared studio…", synced: "Saved to collection", saving: "Saving…",
  retry: "Offline or busy · retrying", conflict: "Resolve concurrent edits", error: "Cloud save paused",
};

function checkpoint(source: StudioSource): Checkpoint {
  return { revision: source.syncRevision ?? 0, snapshot: studioSnapshot(studioDocument(source)) };
}

function fromDisk(raw: string | null) {
  if (!raw) return { base: null, pending: null, legacyConflict: false };
  const cloud = (JSON.parse(raw) as { cloud?: { base?: Checkpoint; pending?: StudioSave; conflict?: Conflict } }).cloud;
  const revision = revisionSchema.safeParse(cloud?.base?.revision);
  const snapshot = snapshotSchema.safeParse(cloud?.base?.snapshot);
  const pending = saveStudioSchema.safeParse(cloud?.pending);
  return { base: revision.success && snapshot.success ? { revision: revision.data, snapshot: snapshot.data } : null,
    pending: pending.success ? pending.data : null, legacyConflict: cloud?.conflict?.base === null };
}

export function useStudioSync(source: StudioSource, store: StoreApi<FoundryStore>, presence: Omit<PresenceInput, "clientId">) {
  const enabled = source.ownerId !== "guest" && typeof source.syncRevision === "number";
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<SyncState>(enabled ? "connecting" : "original");
  const [message, setMessage] = useState("");
  const [conflicts, showConflicts] = useState<string[]>([]);
  const [peers, setPeers] = useState<StudioPresence[]>([]);
  const resolve = useRef<(choice: Choice) => void>(() => {});
  const retry = useRef<() => void>(() => {});
  const client = useRef("");
  const latestPresence = useRef(presence);
  latestPresence.current = presence;
  const room = "/api/collections/" + encodeURIComponent(source.id);

  useEffect(() => {
    const legacyKey = studioDraftKey(source);
    let tabDraftId = client.current || crypto.randomUUID();
    if (enabled) {
      try {
        tabDraftId = sessionStorage.getItem(legacyKey + ":tab") ?? tabDraftId;
        sessionStorage.setItem(legacyKey + ":tab", tabDraftId);
      } catch {}
    }
    const storageKey = enabled ? legacyKey + ":draft:" + tabDraftId : legacyKey;
    const sourceHead = checkpoint(source);
    let base = sourceHead;
    let pending: StudioSave | null = null;
    let conflict: Conflict | null = null;
    let remoteRevision = sourceHead.revision;
    let stopped = false;
    let busy = false;
    let halted = false;
    let mute = false;
    let failureCount = 0;
    let timer: number | undefined;
    const connection = new AbortController();
    client.current ||= crypto.randomUUID();

    const current = () => studioSnapshot(store.getState().document);
    function replace(snapshot: StudioSnapshot) {
      if (sameSnapshot(snapshot, current())) return;
      mute = true;
      try {
        const restored = snapshotDocument(source, snapshot);
        store.setState({ document: { ...restored, revision: store.getState().document.revision + 1 }, past: [], future: [] });
      } finally {
        mute = false;
      }
    }

    function persist(): boolean {
      try {
        const snapshot = current();
        if (enabled && !pending && !conflict && sameSnapshot(snapshot, base.snapshot)) {
          localStorage.removeItem(storageKey);
        } else {
          localStorage.setItem(storageKey, JSON.stringify({ ...snapshot, cloud: enabled ? { base, pending, conflict } : undefined }));
        }
        if (!enabled) setState("local");
        return true;
      } catch {
        if (!enabled) setState("session");
        else setMessage("Local backup storage is unavailable.");
        return false;
      }
    }

    function pause(next: Conflict) {
      conflict = next;
      showConflicts(next.labels);
      setState("conflict");
      persist();
    }

    function integrate(knownBase: StudioSnapshot, remote: Checkpoint) {
      if (remote.revision < base.revision) return;
      const merged = mergeStudioSnapshots(knownBase, current(), remote.snapshot);
      if (merged.conflicts.length) {
        pause({ base: knownBase, remote, labels: merged.conflicts });
      } else {
        base = remote;
        conflict = null;
        showConflicts([]);
        replace(merged.snapshot);
        persist();
        setState(sameSnapshot(current(), base.snapshot) ? "synced" : "saving");
      }
    }

    try {
      const tabDraft = localStorage.getItem(storageKey);
      const legacyDraft = enabled && !tabDraft ? localStorage.getItem(legacyKey) : null;
      const raw = tabDraft ?? legacyDraft;
      if (raw) {
        const restored = decodeStudioDraft(source, raw);
        const disk = fromDisk(raw);
        store.setState({ document: restored });
        if (!enabled) setState("local");
        else if (disk.legacyConflict) {
          pause({ base: null, remote: sourceHead, labels: ["Draft from before shared autosave"] });
        } else if (disk.base) {
          base = disk.base;
          pending = disk.pending;
          if (!pending) integrate(base.snapshot, sourceHead);
          else setState("saving");
        } else if (!sameSnapshot(current(), sourceHead.snapshot) && sourceHead.revision > 0) {
          pause({ base: null, remote: sourceHead, labels: ["Draft from before shared autosave"] });
        } else {
          setState(sameSnapshot(current(), sourceHead.snapshot) ? "synced" : "saving");
        }
        if (legacyDraft && persist() && localStorage.getItem(legacyKey) === legacyDraft) localStorage.removeItem(legacyKey);
      } else if (enabled) setState("synced");
    } catch {
      if (enabled) setState("synced");
      else setState("session");
      setMessage("The stored draft could not be opened.");
    }
    setReady(true);

    function schedule(delay = 380) {
      if (!enabled || halted || stopped || timer !== undefined || busy) return;
      timer = window.setTimeout(() => { timer = undefined; void pump(); }, delay);
    }

    async function refresh() {
      const response = await fetch(room + "/studio", { signal: connection.signal, cache: "no-store" });
      if (!response.ok) throw new Error("The shared collection is temporarily unavailable.");
      const { studio } = await response.json() as { studio: StudioSource };
      if (stopped) return;
      const latest = checkpoint(studio);
      // The GET can already include a newer commit than the queued notification.
      remoteRevision = Math.max(remoteRevision, latest.revision);
      if (conflict?.base === null) {
        pause({ ...conflict, remote: latest });
      } else {
        integrate(conflict?.base ?? base.snapshot, latest);
      }
    }

    async function save() {
      pending ??= { requestId: crypto.randomUUID(), expectedRevision: base.revision, snapshot: current() };
      const sent = pending;
      setState("saving");
      persist();
      const response = await fetch(room + "/studio", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sent), signal: connection.signal,
      });
      if (response.status === 409 || response.ok) {
        const result = await response.json() as SaveResponse;
        if (stopped) return;
        pending = null;
        integrate(result.state === "saved" ? sent.snapshot : base.snapshot, checkpoint(result.studio));
        return;
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const error = await response.json().catch(() => ({})) as { message?: string };
        pending = null;
        halted = true;
        setState("error");
        setMessage(error.message ?? (response.status === 413 ? "The draft exceeds the shared save limit." : "The server could not save the draft."));
        persist();
        return;
      }
      throw new Error("The save could not reach the shared collection.");
    }

    async function pump() {
      if (stopped || busy || halted) return;
      busy = true;
      try {
        if (pending && !conflict) await save();
        else if (remoteRevision > (conflict?.remote.revision ?? base.revision)) await refresh();
        else if (!conflict && !sameSnapshot(current(), base.snapshot)) await save();
        failureCount = 0;
      } catch {
        if (!stopped) {
          failureCount++;
          setState(conflict ? "conflict" : "retry");
        }
      } finally {
        busy = false;
        if (!stopped && (remoteRevision > (conflict?.remote.revision ?? base.revision)
            || (!conflict && (pending || !sameSnapshot(current(), base.snapshot))))) {
          schedule(failureCount ? Math.min(15_000, 1000 * 2 ** failureCount) : 180);
        }
      }
    }

    resolve.current = choice => {
      if (!conflict) return;
      const mine = current();
      const remote = conflict.remote;
      const chosen = conflict.base ? mergeStudioSnapshots(conflict.base, mine, remote.snapshot, choice).snapshot
        : choice === "local" ? mine : remote.snapshot;
      if (choice === "remote") {
        try { localStorage.setItem(storageKey + ":recovery", JSON.stringify(mine)); } catch {}
      }
      base = remote;
      conflict = null;
      showConflicts([]);
      replace(chosen);
      persist();
      setState(sameSnapshot(chosen, remote.snapshot) ? "synced" : "saving");
      schedule(0);
    };
    retry.current = () => { halted = false; setMessage(""); schedule(0); };

    const unsubscribe = store.subscribe((next, previous) => {
      if (mute || next.document === previous.document) return;
      persist();
      if (enabled && !conflict) {
        halted = false;
        setMessage("");
        setState("saving");
        schedule();
      }
    });

    function rebuildPeers(entries: StudioPresence[]) {
      const now = Date.now();
      return entries.filter(entry => entry.clientId !== client.current && entry.expiresAt > now);
    }

    const stream = enabled ? new EventSource(room + "/events") : null;
    stream?.addEventListener("revision", event => {
      try {
        const { revision } = JSON.parse((event as MessageEvent).data) as { revision: number };
        if (Number.isSafeInteger(revision)) {
          remoteRevision = Math.max(remoteRevision, revision);
          schedule(0);
        }
      } catch {}
    });
    stream?.addEventListener("roster", event => {
      try {
        const entries: StudioPresence[] = JSON.parse((event as MessageEvent).data);
        setPeers(rebuildPeers(entries));
      } catch {}
    });
    stream?.addEventListener("presence", event => {
      try {
        const entry: StudioPresence = JSON.parse((event as MessageEvent).data);
        setPeers(entries => rebuildPeers([...entries.filter(item => item.clientId !== entry.clientId), entry]));
      } catch {}
    });
    const cleanupRoster = enabled ? window.setInterval(() => setPeers(rebuildPeers), 15_000) : undefined;
    const online = () => schedule(0);
    window.addEventListener("online", online);
    schedule(0);
    return () => {
      stopped = true;
      connection.abort();
      stream?.close();
      unsubscribe();
      window.clearTimeout(timer);
      window.clearInterval(cleanupRoster);
      window.removeEventListener("online", online);
    };
  }, [enabled, room, source, store]);

  useEffect(() => {
    if (!enabled || !ready) return;
    const controller = new AbortController();
    function announce() {
      if (document.visibilityState !== "visible" || !client.current) return;
      void fetch(room + "/presence", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ ...latestPresence.current, clientId: client.current }),
      }).catch(() => {});
    }
    const next = window.setTimeout(announce, 300);
    const heartbeat = window.setInterval(announce, 18_000);
    document.addEventListener("visibilitychange", announce);
    return () => {
      controller.abort();
      window.clearTimeout(next);
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", announce);
    };
  }, [enabled, room, ready, presence.glyph, presence.anchor?.contour, presence.anchor?.index]);

  return { ready, status: labels[state], state, message, conflicts, peers, enabled, resolve, retry };
}
