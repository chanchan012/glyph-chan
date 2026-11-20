import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { validator } from "hono/validator";
import { collectionId } from "../../lib/collections";
import { agentInput } from "../../lib/foundry/mcp-contract";
import { studioRepository, type StudioRepository } from "../studio-repository";
import { activeAgent, agentStore, issueAgentToken, publicAgent, type AgentStore } from "./credentials";

export function createCredentialRoutes(store: AgentStore = agentStore, repository: StudioRepository = studioRepository) {
  const router = new Hono<{ Variables: { userId: string | null } }>();
  return router.get("/:id/mcp-token", async c => {
    const id = collectionId.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "invalid_collection" }, 400);
    const owner = c.get("userId");
    if (!owner) return c.json({ error: "authentication_required" }, 401);
    if (!await repository.head(owner, id.data)) return c.json({ error: "collection_not_found" }, 404);
    const saved = await store.get(id.data);
    return c.json({ agent: activeAgent(saved) && saved.ownerId === owner ? publicAgent(saved) : null });
  }).post("/:id/mcp-token", bodyLimit({ maxSize: 2048 }), validator("json", (input, c) => {
    const parsed = agentInput.safeParse(input);
    return parsed.success ? parsed.data : c.json({ error: "invalid_agent_label" }, 400);
  }), async c => {
    const id = collectionId.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "invalid_collection" }, 400);
    const owner = c.get("userId");
    if (!owner) return c.json({ error: "authentication_required" }, 401);
    if (!await repository.head(owner, id.data)) return c.json({ error: "collection_not_found" }, 404);
    return c.json(await issueAgentToken(store, owner, id.data, c.req.valid("json").label), 201);
  }).delete("/:id/mcp-token", async c => {
    const id = collectionId.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "invalid_collection" }, 400);
    const owner = c.get("userId");
    if (!owner) return c.json({ error: "authentication_required" }, 401);
    if (!await repository.head(owner, id.data)) return c.json({ error: "collection_not_found" }, 404);
    await store.delete(id.data);
    return c.body(null, 204);
  });
}
