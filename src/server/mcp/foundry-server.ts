import { McpServer, ResourceNotFoundError, ResourceTemplate, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ExportInputError, exportRequest, toExportRequest } from "../../lib/exports/contracts";
import { recordCommand } from "../../lib/foundry/document";
import { auditOpticalConsistency } from "../../lib/foundry/optics";
import { studioDocument } from "../../lib/foundry/studio-source";
import { presenceAnchorSchema, revisionSchema, snapshotSchema, studioSnapshot,
  type PresenceInput, type StudioActor, type StudioReceipt } from "../../lib/foundry/sync-contract";
import type { FoundryCommand, GlyphFoundryState } from "../../lib/foundry/types";
import { parsePath } from "../../lib/vector/svg";
import { canQueueExports, exportJobStore, type ExportJobStore } from "../export-jobs";
import { queueExport } from "../queue-export";
import { presenceLifetime, studioLive, type StudioLive } from "../studio-live";
import { publishStudioReceipt } from "../studio-live-routes";
import { studioRepository, type StudioRepository } from "../studio-repository";
import type { AgentCredential } from "./credentials";

const info = { name: "glyph-foundry", version: "0.1.0" };
const mimeType = "application/json";
const glyphKey = z.string().min(1).max(80).regex(/^[^\p{Cc}\p{Cs}]+$/u);
const signed = z.number().int().min(-32768).max(32767);
const index = z.number().int().min(0).max(511);
const mutation = z.object({
  requestId: z.uuid().optional(), expectedRevision: revisionSchema.optional(),
  anchor: presenceAnchorSchema.optional().describe("Optional contour and anchor indices to highlight in the shared studio."),
});
type Mutation = z.infer<typeof mutation>;
const metrics = z.object({ advanceWidth: z.number().int().min(0).max(65535), leftBearing: signed, rightBearing: signed }).strict();
const paths = z.array(z.string().max(150_000)).min(1).max(256);
const coordinate = z.number().min(-10_000_000).max(10_000_000);
const point = z.object({ x: coordinate, y: coordinate }).strict();
const segment = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line"), to: point }).strict(),
  z.object({ kind: z.literal("quadratic"), control: point, to: point }).strict(),
  z.object({ kind: z.literal("cubic"), control1: point, control2: point, to: point }).strict(),
]);
const contour = z.object({ start: point, closed: z.boolean(), segments: z.array(segment).min(1).max(4096) }).strict();

const metricsUri = "glyph://foundry-metrics";
const kerningUri = "glyph://kerning-table";
function pathUri(key: string) {
  // The URL parser collapses dot segments. Escape those separately from ordinary Unicode names.
  const escaped = key === "." || key === ".." || key.startsWith("~");
  return "glyph://glyph/" + (escaped ? "~" : "") + encodeURIComponent(key) + "/paths";
}

function resourceGlyph(uri: URL) {
  const segment = uri.pathname.slice(1, -"/paths".length);
  try {
    return decodeURIComponent(segment.startsWith("~") ? segment.slice(1) : segment);
  } catch {
    throw new ResourceNotFoundError(uri.href);
  }
}
const resource = (uri: URL, value: unknown) => ({ contents: [{ uri: uri.href, mimeType, text: JSON.stringify(value) }] });

function output(value: Record<string, unknown>, summary = JSON.stringify(value)): CallToolResult {
  return { content: [{ type: "text", text: summary }], structuredContent: value };
}

function failure(message: string, data: Record<string, unknown> = {}): CallToolResult {
  return { isError: true, ...output({ ...data, message }, message) };
}

class AgentToolError extends Error {}

export interface FoundryMcpServices {
  repository?: StudioRepository;
  live?: StudioLive;
  queue?: typeof queueExport;
  canQueue?: () => boolean;
  jobs?: Pick<ExportJobStore, "get" | "artifact">;
  compile?: typeof import("../../lib/exports/compile").compileExport;
}

export function createFoundryMcp(credential: AgentCredential, services: FoundryMcpServices = {}) {
  const server = new McpServer(info, {
    instructions: "This credential grants access to one Glyph collection. Read foundry-metrics and glyph paths before editing. " +
      "Coordinates follow SVG (y down). Use the current shared revision and a fresh requestId when issuing a new mutation.",
  });
  const { ownerId, collectionId, agentId, label } = credential;
  const repository = services.repository ?? studioRepository;
  const live = services.live ?? studioLive;
  const actor: StudioActor = { kind: "agent", id: agentId, label };

  async function readStudio() {
    const studio = await repository.load(ownerId, collectionId);
    if (!studio) throw new AgentToolError("This collection is unavailable.");
    return { studio, document: studioDocument(studio) };
  }

  async function markPresence(glyph: string, anchor: PresenceInput["anchor"]) {
    try {
      await live.announce(collectionId, { clientId: agentId, actor, glyph, anchor, expiresAt: Date.now() + presenceLifetime });
    } catch (error) {
      console.error("Glyph agent presence failed", { cause: (error as Error).name });
    }
  }

  function receiptOutput(receipt: StudioReceipt, revision: number, replay: boolean) {
    return output({ revision, receipt, replay });
  }

  async function mutate(input: Mutation, glyph: string, command: (document: GlyphFoundryState) => FoundryCommand) {
    try {
      const { studio, document } = await readStudio();
      const requestId = input.requestId ?? crypto.randomUUID();
      const receipt = studio.receipts.find(item => item.requestId === requestId);
      if (receipt) {
        return receipt.actor.kind === actor.kind && receipt.actor.id === actor.id
          ? receiptOutput(receipt, studio.syncRevision, true)
          : failure("That request ID was used by another editor.");
      }
      const expectedRevision = input.expectedRevision ?? studio.syncRevision;
      if (expectedRevision !== studio.syncRevision) {
        return failure("The studio changed. Read the latest revision and reapply the edit.", { revision: studio.syncRevision });
      }
      const result = recordCommand(document, {
        id: requestId, actor, timestamp: new Date().toISOString(), command: command(document),
      });
      const anchor = input.anchor ?? null;
      if (anchor) {
        const selected = result.state.glyphs[glyph]?.contours[anchor.contour];
        if (!selected || anchor.index > selected.segments.length) return failure("The highlighted anchor is outside the resulting glyph.");
      }
      if (result.state === document) {
        await markPresence(glyph, anchor);
        return output({ revision: studio.syncRevision, changed: false });
      }
      const snapshot = studioSnapshot(result.state);
      if (!snapshotSchema.safeParse(snapshot).success || Buffer.byteLength(JSON.stringify(snapshot)) > 1_450_000) {
        return failure("The resulting draft exceeds the shared studio limits.");
      }
      const saved = await repository.save(ownerId, collectionId, actor, { requestId, expectedRevision, snapshot });
      if (!saved) return failure("This collection is unavailable.");
      if (saved.state === "conflict") {
        return failure("The studio changed. Read the latest revision and reapply the edit.", { revision: saved.studio.syncRevision });
      }
      if (saved.receipt.actor.kind !== actor.kind || saved.receipt.actor.id !== actor.id) {
        return failure("That request ID was used by another editor.");
      }
      if (!saved.replay) await Promise.all([publishStudioReceipt(live, collectionId, saved.receipt), markPresence(glyph, anchor)]);
      return receiptOutput(saved.receipt, saved.studio.syncRevision, saved.replay);
    } catch (error) {
      if (error instanceof AgentToolError || error instanceof RangeError || error instanceof SyntaxError || error instanceof TypeError) {
        return failure(error.message);
      }
      console.error("Glyph agent edit failed", { cause: (error as Error).name });
      return failure("The shared studio could not save this edit.");
    }
  }

  server.registerResource("foundry-metrics", metricsUri, { mimeType, description: "Optical guides, EM square, and measured stroke targets." }, async uri => {
    const { studio, document } = await readStudio();
    const { stemReference, stemTolerance, overshootTolerance } = auditOpticalConsistency(document);
    return resource(uri, { revision: studio.syncRevision, baseline: 0, ...studio.metrics,
      strokeTargets: { stemReference, stemTolerance, overshootTolerance } });
  });
  server.registerResource("kerning-table", kerningUri, { mimeType, description: "Saved pair adjustments in font units." }, async uri => {
    const { studio, document } = await readStudio();
    return resource(uri, { revision: studio.syncRevision, pairs: document.kerning });
  });
  const glyphPaths = new ResourceTemplate("glyph://glyph/{char}/paths", {
    list: async () => {
      const { studio } = await readStudio();
      return { resources: studio.glyphs.map(({ key }) => ({ uri: pathUri(key), name: key + " paths", mimeType })) };
    },
  });
  server.registerResource("glyph-paths", glyphPaths, { mimeType, description: "Canonical SVG commands, anchor coordinates, handles, and bearings." },
    async uri => {
      const { studio, document } = await readStudio();
      const key = resourceGlyph(uri);
      if (!Object.hasOwn(document.glyphs, key)) throw new ResourceNotFoundError(uri.href);
      const glyph = document.glyphs[key];
      return resource(uri, { revision: studio.syncRevision, ...glyph, paths: studio.glyphs.find(item => item.key === key)?.paths ?? [] });
    });

  server.registerTool("create_glyph", {
    title: "Create glyph", description: "Create a glyph with default or supplied advance width and bearings.",
    inputSchema: mutation.extend({ glyph: glyphKey, metrics: metrics.optional() }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, args => mutate(args, args.glyph, () => ({ type: "createGlyph", key: args.glyph, metrics: args.metrics })));

  const draw = mutation.extend({ glyph: glyphKey, mode: z.enum(["append", "replace"]).default("append"),
    paths: paths.optional(), contours: z.array(contour).min(1).max(256).optional() }).strict();
  server.registerTool("draw_bezier_contours", {
    title: "Draw Bézier contours",
    description: "Supply either SVG paths (M/L/Q/C/Z) or explicit contours with line, quadratic, or cubic segments.",
    inputSchema: draw, annotations: { openWorldHint: false },
  }, args => mutate(args, args.glyph, document => {
    if (Boolean(args.paths) === Boolean(args.contours)) throw new AgentToolError("Supply one of paths or contours.");
    const incoming = args.contours ?? args.paths!.flatMap(parsePath);
    if (incoming.length === 0) throw new AgentToolError("At least one contour is required.");
    const existing = Object.hasOwn(document.glyphs, args.glyph) ? document.glyphs[args.glyph].contours : [];
    return { type: "replaceContours", key: args.glyph, contours: args.mode === "append" ? [...existing, ...incoming] : incoming };
  }));

  server.registerTool("apply_boolean_operation", {
    title: "Apply boolean operation", description: "Union, subtract, or intersect two sets of closed contour indices.",
    inputSchema: mutation.extend({ glyph: glyphKey, operation: z.enum(["union", "subtract", "intersect"]),
      subject: z.array(index).min(1).max(256), clip: z.array(index).min(1).max(256) }).strict(),
    annotations: { openWorldHint: false },
  }, args => mutate(args, args.glyph, () => ({
    type: "applyBoolean", key: args.glyph, operation: args.operation, subject: args.subject, clip: args.clip,
  })));

  server.registerTool("transform_contours", {
    title: "Transform contours", description: "Apply an SVG affine matrix [a,b,c,d,e,f] to the selected contours or all contours.",
    inputSchema: mutation.extend({ glyph: glyphKey, indices: z.array(index).min(1).max(512).optional(),
      matrix: z.tuple([coordinate, coordinate, coordinate, coordinate, coordinate, coordinate]) }).strict(),
    annotations: { openWorldHint: false },
  }, args => mutate(args, args.glyph, () => ({ type: "transformContours", key: args.glyph, indices: args.indices, matrix: args.matrix })));

  server.registerTool("set_glyph_metrics", {
    title: "Set glyph metrics", description: "Set advanceWidth, leftBearing, and rightBearing in font units.",
    inputSchema: mutation.extend({ glyph: glyphKey, advanceWidth: metrics.shape.advanceWidth, leftBearing: signed, rightBearing: signed }).strict(),
    annotations: { idempotentHint: true, openWorldHint: false },
  }, args => mutate(args, args.glyph, () => ({ type: "setGlyphMetrics", key: args.glyph,
    metrics: { advanceWidth: args.advanceWidth, leftBearing: args.leftBearing, rightBearing: args.rightBearing } })));

  server.registerTool("set_kerning_pair", {
    title: "Set kerning pair", description: "Set the signed adjustment between existing typeface glyphs. Zero removes the pair.",
    inputSchema: mutation.extend({ left: glyphKey, right: glyphKey, adjustment: signed }).strict(),
    annotations: { idempotentHint: true, openWorldHint: false },
  }, args => mutate(args, args.left, () => ({ type: "setKerningPair", left: args.left, right: args.right, adjustment: args.adjustment })));

  const distance = z.number().min(0).max(32767).optional();
  server.registerTool("audit_optical_consistency", {
    title: "Audit optical consistency", description: "Measure stem widths and overshoot against the collection's optical guides.",
    inputSchema: z.object({ stemTarget: distance, stemTolerance: distance, overshootTolerance: distance }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async args => {
    const { studio, document } = await readStudio();
    return output({ revision: studio.syncRevision, ...auditOpticalConsistency(document, args) });
  });

  async function exportSaved(format: "svg" | "woff2") {
    try {
      const { studio, document } = await readStudio();
      const parsed = exportRequest.safeParse(toExportRequest(studio, document, format));
      if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data)) > 960_000) return failure("This collection exceeds the export limits.");
      if (format === "woff2" && studio.kind !== "typeface") return failure("Only typefaces can compile a WOFF2 font.");
      if (format === "woff2" && (services.canQueue ?? canQueueExports)()) {
        const job = await (services.queue ?? queueExport)(ownerId, parsed.data);
        return output({ ...job, revision: studio.syncRevision, statusPath: "/api/exports/" + job.id,
          downloadPath: "/api/exports/" + job.id + "/download" });
      }
      const compile = services.compile ?? (await import("../../lib/exports/compile")).compileExport;
      const artifact = await compile(parsed.data);
      const data = format === "svg" ? { svg: new TextDecoder().decode(artifact.bytes) }
        : { base64: Buffer.from(artifact.bytes).toString("base64") };
      return output({ state: "ready", revision: studio.syncRevision, filename: artifact.filename, contentType: artifact.contentType, ...data },
        "Compiled " + artifact.filename);
    } catch (error) {
      if (error instanceof AgentToolError || error instanceof ExportInputError) return failure(error.message);
      console.error("Glyph agent export failed", { cause: (error as Error).name });
      return failure("The export could not be prepared.");
    }
  }

  async function readCompilation(jobId: string) {
    const jobs = services.jobs ?? exportJobStore;
    const job = await jobs.get(jobId);
    if (!job || job.ownerId !== ownerId || job.collectionId !== collectionId || job.format !== "woff2") {
      return failure("This WOFF2 job is unavailable.");
    }
    if (job.state === "failed") return failure(job.message, { id: jobId, state: "failed" });
    if (job.state === "queued") return output({ id: jobId, state: "queued" });
    const artifact = await jobs.artifact(jobId);
    if (!artifact) return failure("This WOFF2 job has expired.");
    return output({ id: jobId, state: "ready", filename: artifact.filename, contentType: artifact.contentType, base64: artifact.data },
      "Compiled " + artifact.filename);
  }

  const empty = z.object({}).strict();
  server.registerTool("export_svg_icons", {
    title: "Export SVG icons", description: "Compile the committed icon set into an SVG sprite.",
    inputSchema: empty, annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => exportSaved("svg"));
  server.registerTool("trigger_woff2_compile", {
    title: "Compile WOFF2", description: "Queue the current typeface in Inngest or compile it directly. Pass a returned jobId to check status or retrieve its WOFF2.",
    inputSchema: z.object({ jobId: z.uuid().optional() }).strict(), annotations: { destructiveHint: false, openWorldHint: false },
  }, ({ jobId }) => jobId ? readCompilation(jobId) : exportSaved("woff2"));

  return server;
}
