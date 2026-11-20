import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { validator } from "hono/validator";
import { collectionId } from "../lib/collections";
import { presenceInput, saveStudioSchema, type StudioActor, type StudioPresence, type StudioReceipt } from "../lib/foundry/sync-contract";
import { InvalidStudioDraft, studioRepository, type StudioRepository } from "./studio-repository";
import { presenceLifetime, studioLive, type StudioLive } from "./studio-live";

export interface StudioSyncServices {
  studioRepository?: StudioRepository;
  studioLive?: StudioLive;
  /** Set shorter only for runtime-local tests of the heartbeat and reconnect. */
  studioHeartbeatMs?: number;
}

export function humanActor(ownerId: string): StudioActor {
  return { kind: "human", id: ownerId, label: "Designer" };
}

export async function publishStudioReceipt(live: StudioLive, id: string, receipt: StudioReceipt) {
  try {
    await live.publishRevision(id, receipt);
  } catch (error) {
    // Reconnect and the heartbeat reconcile against Neon even if publish failed.
    console.error("Studio revision publish failed", { collection: id, cause: (error as Error).name });
  }
}

function expiryAfter(ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<void>(resolve => { timer = setTimeout(resolve, ms); });
  return { promise, clear: () => clearTimeout(timer) };
}

export function createStudioLiveRoutes(services: StudioSyncServices = {}) {
  const repository = services.studioRepository ?? studioRepository;
  const live = services.studioLive ?? studioLive;
  const heartbeat = services.studioHeartbeatMs ?? 15_000;
  const routes = new Hono<{ Variables: { userId: string | null } }>();

  return routes.patch("/:id/studio",
    bodyLimit({ maxSize: 1_500_000, onError: c => c.json({ error: "draft_too_large" }, 413) }),
    validator("json", (body, c) => {
      const input = saveStudioSchema.safeParse(body);
      return input.success ? input.data : c.json({ error: "invalid_draft" }, 400);
    }),
    async c => {
      const id = collectionId.safeParse(c.req.param("id"));
      const owner = c.get("userId");
      if (!owner) return c.json({ error: "authentication_required" }, 401);
      if (!id.success) return c.json({ error: "invalid_collection" }, 400);
      try {
        const result = await repository.save(owner, id.data, humanActor(owner), c.req.valid("json"));
        if (!result) return c.json({ error: "collection_not_found" }, 404);
        if (result.state === "conflict") return c.json(result, 409);
        if (!result.replay) await publishStudioReceipt(live, id.data, result.receipt);
        return c.json(result);
      } catch (error) {
        if (error instanceof InvalidStudioDraft) return c.json({ error: "invalid_draft", message: error.message }, 422);
        throw error;
      }
    })
    .post("/:id/presence", bodyLimit({ maxSize: 8192 }), validator("json", (body, c) => {
      const input = presenceInput.safeParse(body);
      return input.success ? input.data : c.json({ error: "invalid_presence" }, 400);
    }), async c => {
      const id = collectionId.safeParse(c.req.param("id"));
      const owner = c.get("userId");
      if (!owner) return c.json({ error: "authentication_required" }, 401);
      if (!id.success) return c.json({ error: "invalid_collection" }, 400);
      if (!await repository.head(owner, id.data)) return c.json({ error: "collection_not_found" }, 404);
      const input = c.req.valid("json");
      const accepted = await live.announce(id.data, { ...input, actor: humanActor(owner), expiresAt: Date.now() + presenceLifetime });
      return accepted ? c.body(null, 204) : c.json({ error: "presence_capacity" }, 429);
    })
    .get("/:id/events", async c => {
      const id = collectionId.safeParse(c.req.param("id"));
      const owner = c.get("userId");
      if (!owner) return c.json({ error: "authentication_required" }, 401);
      if (!id.success) return c.json({ error: "invalid_collection" }, 400);
      const initial = await repository.head(owner, id.data);
      if (!initial) return c.json({ error: "collection_not_found" }, 404);
      const room = id.data;
      c.header("X-Accel-Buffering", "no");
      return streamSSE(c, async stream => {
        let closed = false;
        let lastRevision = -1;
        let stop = () => {};
        const aborted = new Promise<void>(resolve => { stop = resolve; });
        const close = () => { closed = true; stop(); };
        stream.onAbort(close);
        const revision = (value: number, receipt?: StudioReceipt) => {
          if (closed || value <= lastRevision) return Promise.resolve();
          lastRevision = value;
          return stream.writeSSE({ id: String(value), event: "revision", data: JSON.stringify({ revision: value, receipt }) });
        };
        const presence = (event: "presence" | "roster", data: StudioPresence | StudioPresence[]) =>
          closed ? Promise.resolve() : stream.writeSSE({ event, data: JSON.stringify(data) });
        let subscription: ReturnType<StudioLive["subscribe"]> | undefined;
        try {
          try {
            subscription = live.subscribe(room, event => {
              if (event?.type === "revision") void revision(event.receipt.revision, event.receipt).catch(close);
              if (event?.type === "presence") void presence("presence", event.entry).catch(close);
            });
          } catch {
            // The committed revision can still be reconciled if Pub/Sub is temporarily unavailable.
          }
          await revision(initial.syncRevision, initial.receipts.at(-1));
          if (subscription) {
            const handshake = expiryAfter(2500);
            try { await Promise.race([subscription.ready, handshake.promise, aborted]); }
            finally { handshake.clear(); }
          }
          // Subscribe first, then read the committed revision to close the connection race.
          const end = Date.now() + 52_000;
          while (!closed && Date.now() < end) {
            const head = await repository.head(owner, room);
            if (!head || closed) break;
            await revision(head.syncRevision, head.receipts.at(-1));
            await presence("roster", await live.roster(room).catch(() => []));
            await stream.writeSSE({ event: "heartbeat", data: String(Date.now()) });
            const wait = expiryAfter(Math.min(heartbeat, Math.max(0, end - Date.now())));
            try { await Promise.race([wait.promise, aborted]); }
            finally { wait.clear(); }
          }
        } finally {
          close();
          subscription?.close();
        }
      });
    });
}
