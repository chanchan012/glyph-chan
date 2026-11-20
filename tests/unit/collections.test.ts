import { randomUUID } from "node:crypto";
import { InngestTestEngine } from "@inngest/test";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../src/server/api";
import type { Collection } from "../../src/lib/collections";
import type { CollectionStore } from "../../src/server/collections";
import * as previews from "../../src/server/collections";
import { generateThumbnail, renderThumbnail } from "../../src/inngest/thumbnails";

function setup() {
  const rows = new Map<string, Collection & { ownerId: string }>();
  const store: CollectionStore = {
    async list(ownerId) {
      return Array.from(rows.values()).filter(record => record.ownerId === ownerId);
    },
    async create(ownerId, input) {
      const row = { ...input, id: randomUUID(), thumbnail: null, updatedAt: new Date().toISOString() };
      rows.set(row.id, { ...row, ownerId });
      return row;
    },
    async rename(ownerId, id, name) {
      const row = rows.get(id);
      if (row?.ownerId !== ownerId) return null;
      const renamed = { ...row, name, thumbnail: null };
      rows.set(id, renamed);
      return renamed;
    },
    async remove(ownerId, id) {
      return rows.get(id)?.ownerId === ownerId && rows.delete(id);
    },
  };
  const queue = vi.fn(async () => undefined);
  const app = (userId: string | null) => createApi({
    identify: async (c, next) => { c.set("userId", userId); await next(); },
    limit: async () => null,
    collections: store,
    requestThumbnail: queue,
  });
  return { app, queue };
}

const origin = "http://localhost";
const base = origin + "/api/collections";
function mutation(method: string, body?: object) {
  return { method, headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

describe("collection RPC", () => {
  it("creates, lists, renames and deletes collections as their owner", async () => {
    const { app, queue } = setup();
    const member = app("owner-a");
    const created = await member.request(base, mutation("POST", { name: " Forma ", kind: "typeface" }));
    const icon = await member.request(base, mutation("POST", { name: "Orbit", kind: "icon_set" }));
    expect(created.status).toBe(201);
    expect(icon.status).toBe(201);
    const { collection } = await created.json() as { collection: Collection };
    expect(collection.name).toBe("Forma");
    const url = base + "/" + collection.id;
    expect((await member.request(url, mutation("PATCH", { name: "Forma Serif" }))).status).toBe(200);
    const { collections } = await (await member.request(base)).json() as { collections: Collection[] };
    expect(collections.map(row => row.name)).toEqual(["Forma Serif", "Orbit"]);
    expect(queue).toHaveBeenCalledTimes(3);
    expect(queue).toHaveBeenLastCalledWith("owner-a", collection.id);
    expect((await member.request(url, mutation("DELETE"))).status).toBe(204);
    expect((await member.request(url, mutation("DELETE"))).status).toBe(404);
  });

  it("protects guest and cross-owner access", async () => {
    const { app } = setup();
    const created = await app("owner-a").request(base, mutation("POST", { name: "Forma", kind: "typeface" }));
    const { collection } = await created.json() as { collection: Collection };
    const url = base + "/" + collection.id;
    expect((await app(null).request(base)).status).toBe(401);
    expect(await (await app("owner-b").request(base)).json()).toEqual({ collections: [] });
    expect((await app("owner-b").request(url, mutation("PATCH", { name: "Change" }))).status).toBe(404);
    expect((await app("owner-b").request(url, mutation("DELETE"))).status).toBe(404);
  });

  it("rejects cross-origin writes, malformed inputs, and injected ownership", async () => {
    const { app, queue } = setup();
    const member = app("owner-a");
    expect((await member.request(base, { ...mutation("POST"), headers: { Origin: "https://other.example" } })).status).toBe(403);
    expect((await member.request(base, mutation("POST", { name: " ", kind: "typeface" }))).status).toBe(400);
    expect((await member.request(base, mutation("POST", { name: "Forma", kind: "typeface", ownerId: "owner-b" }))).status).toBe(400);
    expect(queue).not.toHaveBeenCalled();
  });
});

describe("Inngest thumbnail job", () => {
  const target = { id: randomUUID(), ownerId: "owner-a", name: "<Orbit & Co>", kind: "icon_set" as const };

  it("runs the registered worker and saves an escaped specimen for the matching owner", async () => {
    const loadPreviewTarget = vi.spyOn(previews, "loadPreviewTarget").mockResolvedValue(target);
    const saveThumbnail = vi.spyOn(previews, "saveThumbnail").mockResolvedValue(true);
    try {
      const worker = new InngestTestEngine({ function: renderThumbnail });
      const { result } = await worker.execute({
        events: [{ name: "glyph/thumbnail.requested", data: { id: target.id, ownerId: target.ownerId } }],
      });
      expect(result).toEqual({ saved: true });
      expect(loadPreviewTarget).toHaveBeenCalledWith(target.ownerId, target.id);
      expect(saveThumbnail).toHaveBeenCalledWith(target, expect.stringContaining("&lt;Orbit &amp; Co&gt;"));
      expect(saveThumbnail).toHaveBeenCalledWith(target, expect.stringContaining("<path"));
    } finally {
      loadPreviewTarget.mockRestore();
      saveThumbnail.mockRestore();
    }
  });

  it("skips deleted or completed collections and reports stale writes", async () => {
    const saveThumbnail = vi.fn(async () => false);
    expect(await generateThumbnail(target, { loadPreviewTarget: async () => null, saveThumbnail })).toEqual({ saved: false });
    expect(saveThumbnail).not.toHaveBeenCalled();
    expect(await generateThumbnail(target, { loadPreviewTarget: async () => target, saveThumbnail })).toEqual({ saved: false });
  });
});
