import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { limitApi, retryAfter, type RateLimit } from "../rate-limit";
import { requestOrigin } from "../request-origin";
import { studioRepository } from "../studio-repository";
import { agentStore, parseAgentToken, verifyAgentToken, type AgentStore } from "./credentials";
import { createFoundryMcp, type FoundryMcpServices } from "./foundry-server";

declare module "hono" {
  interface ContextVariableMap {
    parsedBody?: unknown;
  }
}

export interface McpHttpServices extends FoundryMcpServices {
  credentials?: AgentStore;
  limit?: RateLimit;
}

export function createMcpHttp(services: McpHttpServices = {}) {
  const app = createMcpHonoApp({ host: "glyph-chan.vercel.app", maxRequestBodySize: 1_000_000 });
  const credentials = services.credentials ?? agentStore;
  const repository = services.repository ?? studioRepository;
  const limit = services.limit ?? limitApi;

  app.onError((error, c) => {
    console.error("Glyph MCP request failed", { cause: error.name });
    c.header("Cache-Control", "private, no-store");
    return c.json({ error: "service_unavailable" }, 503);
  });
  return app.all("/api/mcp", async c => {
    c.header("Cache-Control", "private, no-store");
    const origin = c.req.header("Origin");
    if (origin !== undefined && origin !== requestOrigin(c.req.raw)) return c.json({ error: "origin_not_allowed" }, 403);
    const unauthenticated = () => {
      c.header("WWW-Authenticate", 'Bearer realm="Glyph"');
      return c.json({ error: "invalid_agent_token" }, 401);
    };
    const token = parseAgentToken(c.req.header("Authorization"));
    if (!token) return unauthenticated();
    const ip = process.env.VERCEL === "1" ? c.req.header("x-vercel-forwarded-for")?.split(",")[0]?.trim() : null;
    const filter = await limit("mcp-ip:" + (ip || "shared"));
    if (filter && !filter.success) {
      c.header("Retry-After", retryAfter(filter.reset));
      return c.json({ error: "rate_limited" }, 429);
    }
    const credential = await verifyAgentToken(credentials, token);
    if (!credential) return unauthenticated();
    const quota = await limit("mcp-collection:" + credential.collectionId);
    if (quota && !quota.success) {
      c.header("Retry-After", retryAfter(quota.reset));
      return c.json({ error: "rate_limited" }, 429);
    }
    if (!await repository.head(credential.ownerId, credential.collectionId)) return unauthenticated();

    const handler = createMcpHandler(() => createFoundryMcp(credential, services), { maxSubscriptions: 1 });
    return handler.fetch(c.req.raw, { parsedBody: c.get("parsedBody") });
  });
}
