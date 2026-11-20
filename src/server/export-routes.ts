import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { validator } from "hono/validator";
import { z } from "zod";
import { collections } from "../db/schema";
import { connectDatabase } from "../db/client";
import { exportRequest, ExportInputError, type ExportArtifact, type ExportRequest } from "../lib/exports/contracts";
import { canQueueExports, exportJobStore, type ExportJobStore } from "./export-jobs";
import { queueExport } from "./queue-export";
import { requestOrigin } from "./request-origin";

async function findCollection(ownerId: string, id: string): Promise<Pick<ExportRequest, "name" | "kind"> | null> {
  const [collection] = await connectDatabase().select({ name: collections.name, kind: collections.kind })
    .from(collections).where(and(eq(collections.id, id), eq(collections.ownerId, ownerId)));
  return collection ?? null;
}

export interface ExportServices {
  store?: ExportJobStore;
  canQueue?: () => boolean;
  findCollection?: typeof findCollection;
  enqueue?: (id: string) => Promise<void>;
  compile?: (input: ExportRequest) => Promise<ExportArtifact>;
}

const uuid = z.uuid();
function download({ filename, contentType, bytes }: ExportArtifact) {
  return new Response(bytes, { headers: {
    "Content-Type": contentType,
    "Content-Disposition": 'attachment; filename="' + filename + '"',
    "Content-Length": String(bytes.byteLength),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  } });
}

export function createExportRoutes(services: ExportServices = {}) {
  const routes = new Hono<{ Variables: { userId: string | null } }>();
  const store = services.store ?? exportJobStore;
  const available = services.canQueue ?? canQueueExports;
  return routes.post("/",
    bodyLimit({ maxSize: 1_000_000, onError: c => c.json({ error: "export_too_large" }, 413) }),
    validator("json", (body, c) => {
      const valid = exportRequest.safeParse(body);
      return valid.success ? valid.data : c.json({ error: "invalid_export" }, 400);
    }),
    async c => {
      if (c.req.header("Origin") !== requestOrigin(c.req.raw)) return c.json({ error: "origin_not_allowed" }, 403);
      const ownerId = c.get("userId");
      let input = c.req.valid("json");
      if (input.collectionId) {
        if (!ownerId) return c.json({ error: "authentication_required" }, 401);
        const collection = await (services.findCollection ?? findCollection)(ownerId, input.collectionId);
        if (!collection || collection.kind !== input.kind) return c.json({ error: "collection_not_found" }, 404);
        input = { ...input, name: collection.name };
        if (available()) {
          return c.json(await queueExport(ownerId, input, store, services.enqueue), 202);
        }
      }
      try {
        const compile = services.compile ?? (await import("../lib/exports/compile")).compileExport;
        return download(await compile(input));
      } catch (error) {
        if (error instanceof ExportInputError) return c.json({ error: "invalid_export", message: error.message }, 422);
        throw error;
      }
    })
    .get("/:id", async c => {
      const ownerId = c.get("userId");
      if (!ownerId) return c.json({ error: "authentication_required" }, 401);
      const id = uuid.safeParse(c.req.param("id"));
      if (!id.success || !available()) return c.json({ error: "export_not_found" }, 404);
      const job = await store.get(id.data);
      if (!job || job.ownerId !== ownerId) return c.json({ error: "export_not_found" }, 404);
      if (job.state === "failed") return c.json({ state: job.state, message: job.message });
      if (job.state === "ready") return c.json({ state: job.state, filename: job.filename });
      return c.json({ state: job.state });
    })
    .get("/:id/download", async c => {
      const ownerId = c.get("userId");
      if (!ownerId) return c.json({ error: "authentication_required" }, 401);
      const id = uuid.safeParse(c.req.param("id"));
      if (!id.success || !available()) return c.json({ error: "export_not_found" }, 404);
      const job = await store.get(id.data);
      if (!job || job.ownerId !== ownerId || job.state !== "ready") return c.json({ error: "export_not_found" }, 404);
      const artifact = await store.artifact(job.id);
      return artifact ? download({ ...artifact, bytes: Uint8Array.from(Buffer.from(artifact.data, "base64")) })
        : c.json({ error: "export_not_found" }, 404);
    });
}
