import { freeze, type Patch } from "immer";
import { createStore } from "zustand/vanilla";
import { applyHistoryPatches, recordCommand } from "./document";
import type { CommandAttribution, CommandEnvelope, GlyphFoundryState } from "./types";

interface HistoryEntry extends CommandAttribution {
  type: CommandEnvelope["command"]["type"];
  patches: Patch[];
  inverse: Patch[];
}

export interface FoundryStore {
  document: GlyphFoundryState;
  past: readonly HistoryEntry[];
  future: readonly HistoryEntry[];
  dispatch(envelope: CommandEnvelope): boolean;
  undo(): boolean;
  redo(): boolean;
}

export function createFoundryStore(initial: GlyphFoundryState, historyLimit = 100) {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) throw new RangeError("History limit must be positive.");

  return createStore<FoundryStore>()((set, get) => ({
    document: freeze(structuredClone(initial), true),
    past: [],
    future: [],
    dispatch(envelope) {
      const { document, past } = get();
      const result = recordCommand(document, envelope);
      if (!result.patches.length) return false;
      const entry: HistoryEntry = freeze({
        id: envelope.id, actor: { ...envelope.actor }, timestamp: envelope.timestamp,
        type: envelope.command.type, patches: result.patches, inverse: result.inverse,
      }, true);
      set({ document: result.state, past: [...past, entry].slice(-historyLimit), future: [] });
      return true;
    },
    undo() {
      const { document, past, future } = get();
      const entry = past.at(-1);
      if (!entry) return false;
      set({ document: applyHistoryPatches(document, entry.inverse), past: past.slice(0, -1), future: [entry, ...future] });
      return true;
    },
    redo() {
      const { document, past, future } = get();
      const entry = future[0];
      if (!entry) return false;
      set({ document: applyHistoryPatches(document, entry.patches), past: [...past, entry], future: future.slice(1) });
      return true;
    },
  }));
}
