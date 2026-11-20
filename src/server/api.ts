import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { clerkKeys } from "./config";
import { collectionId, collectionInput, collectionUpdate } from "../lib/collections";
import { collectionStore, type CollectionStore } from "./collections";
import { loadStudio } from "./studio";
import { requestThumbnail } from "../inngest/client";

type Bindings = { Variables: { userId: string | null } };
type Decision = { success: boolean; reset: number };
interface Services {
  identify: MiddlewareHandler<Bindings>;
  limit: (key: string) => Promise<Decision | null>;
  collections?: CollectionStore;
  loadStudio?: typeof loadStudio;
  requestThumbnail?: typeof requestThumbnail;
}

const identify: Services["identify"] = async (c, next) => {
  const keys = clerkKeys();
  c.set("userId", null);
  if (!keys) return next();
  const origin = new URL(c.req.url).origin;
  return clerkMiddleware({ ...keys, authorizedParties: [origin] })(c, async () => {
    c.set("userId", getAuth(c)?.userId ?? null);
    await next();
  });
};

let limiter: Ratelimit | undefined;
const limit: Services["limit"] = async key => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url && !token && !clerkKeys()) return null;
  if (!url || !token) throw new Error("Rate limiter unavailable");
  limiter ??= new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(60, "1 m"),
    prefix: "glyph:api:v1",
  });
  const result = await limiter.limit(key);
  if (result.reason === "timeout") throw new Error("Rate limiter timed out");
  return result;
};

export function createApi(services: Services = { identify, limit }) {
  const app = new Hono<Bindings>().basePath("/api");
  const store = services.collections ?? collectionStore;
  const queue = services.requestThumbnail ?? requestThumbnail;
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    console.error("Glyph API request failed", { path: c.req.path, cause: error.name });
    return c.json({ error: "service_unavailable" }, 503);
  });
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  app.use("*", services.identify);
  app.use("*", async (c, next) => {
    // Vercel overwrites this header at ingress. Local guests share one bucket.
    const ip = process.env.VERCEL === "1" ? c.req.header("x-vercel-forwarded-for")?.split(",")[0]?.trim() : null;
    const userId = c.get("userId");
    try {
      const result = await services.limit(userId ? "user:" + userId : "guest:" + (ip || "shared"));
      if (result && !result.success) {
        c.header("Retry-After", String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))));
        return c.json({ error: "rate_limited" }, 429);
      }
    } catch {
      return c.json({ error: "service_unavailable" }, 503);
    }
    await next();
  });
  app.use("/collections/*", async (c, next) => {
    if (!c.get("userId")) return c.json({ error: "authentication_required" }, 401);
    if (c.req.method !== "GET" && c.req.header("Origin") !== new URL(c.req.url).origin) {
      return c.json({ error: "origin_not_allowed" }, 403);
    }
    await next();
  });
  return app.get("/health", c => c.json({ service: "glyph", status: "ok" } as const))
    .get("/session", c => {
      const userId = c.get("userId");
      return userId ? c.json({ mode: "member", userId } as const) : c.json({ mode: "guest" } as const);
    })
    .get("/account", c => {
      const userId = c.get("userId");
      return userId ? c.json({ userId }) : c.json({ error: "authentication_required" }, 401);
    })
    .get("/collections", async c => c.json({ collections: await store.list(c.get("userId")!) }))
    .get("/collections/:id/studio", async c => {
      const id = collectionId.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "invalid_collection" }, 400);
      const studio = await (services.loadStudio ?? loadStudio)(c.get("userId")!, id.data);
      return studio ? c.json({ studio }) : c.json({ error: "collection_not_found" }, 404);
    })
    .post("/collections", validator("json", (body, c) => {
      const input = collectionInput.safeParse(body);
      return input.success ? input.data : c.json({ error: "invalid_collection" }, 400);
    }), async c => {
      const ownerId = c.get("userId")!;
      const collection = await store.create(ownerId, c.req.valid("json"));
      await queue(ownerId, collection.id);
      return c.json({ collection }, 201);
    })
    .patch("/collections/:id", validator("json", (body, c) => {
      const input = collectionUpdate.safeParse(body);
      return input.success ? input.data : c.json({ error: "invalid_collection" }, 400);
    }), async c => {
      const id = collectionId.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "invalid_collection" }, 400);
      const ownerId = c.get("userId")!;
      const collection = await store.rename(ownerId, id.data, c.req.valid("json").name);
      if (!collection) return c.json({ error: "collection_not_found" }, 404);
      await queue(ownerId, collection.id);
      return c.json({ collection });
    })
    .delete("/collections/:id", async c => {
      const id = collectionId.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "invalid_collection" }, 400);
      const removed = await store.remove(c.get("userId")!, id.data);
      return removed ? c.body(null, 204) : c.json({ error: "collection_not_found" }, 404);
    });
}
export type AppType = ReturnType<typeof createApi>;
