import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mergeStudioSnapshots } from "../../src/lib/foundry/snapshot-merge";
import type { StudioLiveEvent, StudioPresence, StudioSave, StudioSnapshot } from "../../src/lib/foundry/sync-contract";
import { createApi } from "../../src/server/api";
import type { StudioLive } from "../../src/server/studio-live";
import { createStudioRepository } from "../../src/server/studio-repository";

const database = new PGlite();
const dialect = new PgDialect();
const repository = createStudioRepository(async <Row extends Record<string, unknown>>(statement: SQL) => {
  const { sql, params } = dialect.sqlToQuery(statement);
  return (await database.query<Row>(sql, params)).rows;
});
const owner = "owner";
const actor = { kind: "human", id: owner, label: "Designer" } as const;
const metrics = { unitsPerEm: 1000, ascender: 800, descender: -200, capHeight: 700, xHeight: 500 };
const glyph = (key: string, advanceWidth = 600) => ({
  key, metrics: { advanceWidth, leftBearing: 50, rightBearing: 50 },
  paths: ["M 0 0 L 150 0 L 150 150 Z"],
});
const draft = (glyphs: StudioSnapshot["glyphs"], kerning: StudioSnapshot["kerning"] = []): StudioSnapshot =>
  ({ metrics, glyphs, kerning });
const request = (expectedRevision: number, snapshot: StudioSnapshot): StudioSave =>
  ({ requestId: crypto.randomUUID(), expectedRevision, snapshot });

beforeAll(async () => {
  for (const file of readdirSync("drizzle").filter(file => file.endsWith(".sql")).sort()) {
    await database.exec(readFileSync("drizzle/" + file, "utf8"));
  }
}, 30_000);
afterAll(() => database.close());

async function newRoom() {
  const { rows: [row] } = await database.query<{ id: string }>(
    "INSERT INTO collections (owner_id, name, kind) VALUES ($1, 'Live typeface', 'typeface') RETURNING id", [owner]);
  return row.id;
}

it("commits one concurrent revision and makes retries idempotent", async () => {
  const id = await newRoom();
  const first = request(0, draft([glyph("A")]));
  const rival = request(0, draft([glyph("V")]));
  const results = await Promise.all([repository.save(owner, id, actor, first), repository.save(owner, id, actor, rival)]);
  expect(results.map(result => result?.state).sort()).toEqual(["conflict", "saved"]);
  const accepted = results[0]?.state === "saved" ? first : rival;
  const head = await repository.head(owner, id);
  expect(head).toMatchObject({ syncRevision: 1, receipts: [{ requestId: accepted.requestId, actor }] });
  expect(await repository.load("other", id)).toBeNull();
  expect(await repository.save("other", id, actor, request(1, draft([])))).toBeNull();
  expect(await repository.save(owner, id, actor, request(1, draft([glyph("A"), glyph("V")],
    [{ left: "A", right: "V", adjustment: -40 }])))).toMatchObject({ state: "saved", receipt: { revision: 2 } });
  expect(await repository.save(owner, id, actor, accepted)).toMatchObject({
    state: "saved", receipt: { revision: 1 }, replay: true,
    studio: { syncRevision: 2, kerning: [{ left: "A", right: "V", adjustment: -40 }] },
  });
  expect(await repository.save(owner, id, actor, request(2, draft([glyph("V", 620)])))).toMatchObject({
    state: "saved", studio: { syncRevision: 3, kerning: [], glyphs: [{ key: "V" }] },
  });
  expect(await repository.load(owner, id)).toMatchObject({
    syncRevision: 3, kerning: [], glyphs: [{ key: "V", metrics: { advanceWidth: 620 } }],
  });
});

it("rolls back the revision and previous glyphs if a later write fails", async () => {
  const id = await newRoom();
  await repository.save(owner, id, actor, request(0, draft([glyph("A")])));
  await database.exec("ALTER TABLE glyphs ADD CONSTRAINT studio_test_width CHECK (advance_width <> 666)");
  try {
    await expect(repository.save(owner, id, actor, request(1, draft([glyph("B", 666)])))).rejects.toThrow("studio_test_width");
    expect(await repository.load(owner, id)).toMatchObject({ syncRevision: 1, glyphs: [{ key: "A" }] });
  } finally {
    await database.exec("ALTER TABLE glyphs DROP CONSTRAINT studio_test_width");
  }
});

it("merges different glyphs and preserves kerning choices when a referenced glyph is removed", () => {
  const initial = draft([glyph("A"), glyph("V")]);
  expect(mergeStudioSnapshots(initial, draft([glyph("A", 700), glyph("V")]), draft([glyph("A"), glyph("V", 680)])))
    .toEqual({ snapshot: draft([glyph("A", 700), glyph("V", 680)]), conflicts: [] });
  const pair = { left: "A", right: "V", adjustment: -60 };
  const local = draft([glyph("A", 720)]);
  const remote = draft([glyph("A", 680), glyph("V")], [pair]);
  expect(mergeStudioSnapshots(initial, local, remote))
    .toEqual({ snapshot: local, conflicts: ["Glyph A", "Pair A / V"] });
  expect(mergeStudioSnapshots(initial, local, remote, "remote").snapshot).toEqual(remote);
});

function testLive() {
  const listeners = new Set<(event: StudioLiveEvent) => void>();
  const entries = new Map<string, StudioPresence>();
  const live: StudioLive = {
    async publishRevision(_room, receipt) {
      for (const listener of listeners) listener({ type: "revision", receipt });
    },
    async announce(_room, entry) {
      entries.set(entry.clientId, entry);
      for (const listener of listeners) listener({ type: "presence", entry });
      return true;
    },
    async roster() { return [...entries.values()]; },
    subscribe(_room, listener) {
      listeners.add(listener);
      return { ready: Promise.resolve(), close: () => { listeners.delete(listener); } };
    },
  };
  return { live, listeners };
}

function eventReader(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async expectEvent(name: string) {
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary < 0) {
          const next = await reader.read();
          if (next.done) throw Error("Stream ended before " + name);
          buffer += decoder.decode(next.value, { stream: true });
        } else {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (event.includes("event: " + name + "\n")) {
            return JSON.parse(event.split("\n").find(line => line.startsWith("data: "))!.slice(6));
          }
        }
      }
    },
    close: () => reader.cancel(),
  };
}

it("streams authorized presence and revisions, limits access, and reconciles a lost publish", async () => {
  const id = await newRoom();
  const room = "/api/collections/" + id;
  const { listeners, live } = testLive();
  const app = (userId: string | null, reject = false) => createApi({
    identify: async (c, next) => { c.set("userId", userId); await next(); },
    limit: async () => reject ? { reset: Date.now() + 1000, success: false } : null,
    studioRepository: repository,
    studioLive: live,
    studioHeartbeatMs: 35,
  });
  const member = app(owner);
  const write = (path: string, method: string, payload: unknown, origin = "http://localhost") =>
    member.request(room + path, {
      method, headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  expect((await app(null).request(room + "/events")).status).toBe(401);
  expect((await app("other").request(room + "/events")).status).toBe(404);
  expect((await app(owner, true).request(room + "/events")).status).toBe(429);
  const presence = { clientId: crypto.randomUUID(), glyph: "A", anchor: { contour: 0, index: 1 } };
  expect((await write("/presence", "POST", presence, "https://foreign.example")).status).toBe(403);

  const response = await member.request(room + "/events");
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const stream = eventReader(response);
  try {
    expect(await stream.expectEvent("revision")).toMatchObject({ revision: 0 });
    expect((await write("/presence", "POST", presence)).status).toBe(204);
    expect(await stream.expectEvent("presence")).toMatchObject({ ...presence, actor });
    expect((await write("/studio", "PATCH", request(0, draft([glyph("A")])))).status).toBe(200);
    expect(await stream.expectEvent("revision")).toMatchObject({ revision: 1, receipt: { actor } });
    const lostPublish = vi.spyOn(live, "publishRevision").mockResolvedValueOnce();
    expect((await write("/studio", "PATCH", request(1, draft([glyph("V")])))).status).toBe(200);
    expect(lostPublish).toHaveBeenCalledOnce();
    expect(await stream.expectEvent("revision")).toMatchObject({ revision: 2 });
  } finally {
    await stream.close();
  }
  const reconnect = eventReader(await member.request(room + "/events", { headers: { "Last-Event-ID": "1" } }));
  try {
    expect(await reconnect.expectEvent("revision")).toMatchObject({ revision: 2 });
  } finally {
    await reconnect.close();
  }
  await vi.waitFor(() => expect(listeners.size).toBe(0));
}, 15_000);
