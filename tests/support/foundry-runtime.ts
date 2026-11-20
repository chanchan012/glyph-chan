import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { StudioLiveEvent, StudioPresence } from "../../src/lib/foundry/sync-contract";
import { createApi } from "../../src/server/api";
import type { AgentCredential, AgentStore } from "../../src/server/mcp/credentials";
import { createStudioRepository } from "../../src/server/studio-repository";
import type { StudioLive } from "../../src/server/studio-live";

export async function foundryRuntime() {
  const db = new PGlite();
  const dialect = new PgDialect();
  for (const file of readdirSync("drizzle").filter(file => file.endsWith(".sql")).sort()) {
    await db.exec(readFileSync("drizzle/" + file, "utf8"));
  }
  const repository = createStudioRepository(async <Row extends Record<string, unknown>>(input: SQL) => {
    const { sql, params } = dialect.sqlToQuery(input);
    return (await db.query<Row>(sql, params)).rows;
  });
  const tokens = new Map<string, AgentCredential>();
  const credentials: AgentStore = {
    async get(id) { return tokens.get(id) ?? null; },
    async set(value) { tokens.set(value.collectionId, value); },
    async delete(id) { tokens.delete(id); },
  };
  type Room = { roster: Map<string, StudioPresence>; listeners: Set<(value: StudioLiveEvent) => void> };
  const rooms = new Map<string, Room>();
  function getRoom(id: string) {
    if (!rooms.has(id)) rooms.set(id, { roster: new Map(), listeners: new Set() });
    return rooms.get(id)!;
  }
  const live: StudioLive = {
    async publishRevision(id, receipt) {
      for (const listener of getRoom(id).listeners) listener({ type: "revision", receipt });
    },
    async announce(id, entry) {
      const room = getRoom(id);
      room.roster.set(entry.clientId, entry);
      for (const listener of room.listeners) listener({ type: "presence", entry });
      return true;
    },
    async roster(id) {
      return [...getRoom(id).roster.values()].filter(entry => entry.expiresAt > Date.now());
    },
    subscribe(id, listener) {
      const room = getRoom(id);
      room.listeners.add(listener);
      return { ready: Promise.resolve(), close: () => { room.listeners.delete(listener); } };
    },
  };
  function browserApi(userId: string | null) {
    return createApi({
      identify: async (c, next) => { c.set("userId", userId); await next(); },
      limit: async () => null, studioRepository: repository, studioLive: live, agents: credentials,
    });
  }
  async function collection(ownerId: string, kind: "typeface" | "icon_set" = "typeface") {
    const { rows: [row] } = await db.query<{ id: string }>(
      "INSERT INTO collections (owner_id, name, kind) VALUES ($1, 'Shared specimen', $2) RETURNING id", [ownerId, kind]);
    return row.id;
  }
  return { repository, credentials, live, browserApi, collection, close: () => db.close() };
}
