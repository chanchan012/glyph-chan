import { requestExport } from "../inngest/exports";
import type { ExportRequest } from "../lib/exports/contracts";
import { exportJobStore, type ExportJobStore } from "./export-jobs";

export async function queueExport(ownerId: string, snapshot: ExportRequest,
  store: ExportJobStore = exportJobStore, enqueue: (id: string) => Promise<void> = requestExport) {
  const id = crypto.randomUUID();
  await store.create({
    id, ownerId, createdAt: Date.now(), state: "queued", collectionId: snapshot.collectionId, format: snapshot.format,
  }, snapshot);
  try {
    await enqueue(id);
  } catch (error) {
    // The periodic repair worker re-enqueues snapshots if dispatch is interrupted.
    console.error("Could not enqueue Glyph export", { id, cause: (error as Error).name });
  }
  return { id, state: "queued" } as const;
}
