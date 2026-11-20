import { strFromU8, unzipSync } from "fflate";
import { parse } from "opentype.js";
import { describe, expect, it, vi } from "vitest";
import { decompress } from "wawoff2";
import { compileExport } from "../../src/lib/exports/compile";
import { ExportInputError, toExportRequest, type ExportRequest } from "../../src/lib/exports/contracts";
import { guestStudio, studioDocument } from "../../src/lib/foundry/studio-source";
import { createApi } from "../../src/server/api";
import { runExportJob, type ExportJob, type ExportJobStore } from "../../src/server/export-jobs";

const studio = guestStudio("demo")!;
const document = studioDocument(studio);
const request = toExportRequest(studio, document, "ttf");
const collectionId = "14bd6d3e-4bd8-4f27-b8a5-cba5a3c21e24";

function sfntTags(bytes: Uint8Array<ArrayBuffer>) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: view.getUint16(4) }, (_, i) =>
    String.fromCharCode(...bytes.subarray(12 + i * 16, 16 + i * 16)));
}

function verifyTypeface(bytes: Uint8Array<ArrayBuffer>) {
  expect([...bytes.slice(0, 4)]).toEqual([0, 1, 0, 0]);
  expect(sfntTags(bytes)).toEqual(expect.arrayContaining(["glyf", "cmap", "hmtx", "GPOS", "kern"]));
  const actual = parse(bytes.buffer);
  expect(actual.unitsPerEm).toBe(document.metrics.unitsPerEm);
  const a = actual.charToGlyph("A");
  const v = actual.charToGlyph("V");
  expect(a.index).toBeGreaterThan(0);
  expect(a.advanceWidth).toBe(document.glyphs.A.metrics.advanceWidth);
  expect(actual.getKerningValue(a, v)).toBe(-52);
  expect(actual.charToGlyph("a").path.commands.some(command => command.type === "Q")).toBe(true);
  expect(actual.charToGlyph(" ").advanceWidth).toBe(330);
}

describe("font and icon binary compilation", () => {
  it("writes deterministic TrueType with mapped quadratic outlines and real kerning", async () => {
    const font = await compileExport(request);
    expect(font.filename).toBe("forma-serif.ttf");
    verifyTypeface(font.bytes);
    expect((await compileExport(request)).bytes).toEqual(font.bytes);
  }, 20000);

  it("compresses a decodable WOFF2 and preserves the tables through round trip", async () => {
    const font = await compileExport({ ...request, format: "woff2" });
    expect(font.contentType).toBe("font/woff2");
    expect(String.fromCharCode(...font.bytes.slice(0, 4))).toBe("wOF2");
    const bytes = Uint8Array.from(await decompress(font.bytes));
    verifyTypeface(bytes);
  }, 20000);

  it("packages sanitized standalone SVG, React modules, and a specimen", async () => {
    const source: ExportRequest = {
      ...request, name: '<Studio "&">', kind: "icon_set", kerning: [],
      glyphs: [
        { ...request.glyphs[0], key: '<shape "&">' },
        { ...request.glyphs[1], key: "shape" },
      ],
    };
    const sprite = await compileExport({ ...source, format: "svg" });
    expect(strFromU8(sprite.bytes)).toContain("&lt;shape &quot;&amp;&quot;&gt;");
    const result = await compileExport({ ...source, format: "react" });
    const files = unzipSync(result.bytes);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["index.ts", "sprite.svg", "specimen.svg", "icons/GlyphShape1.tsx", "icons/GlyphShape2.tsx"]));
    expect(strFromU8(files["specimen.svg"])).toContain("&lt;Studio &quot;&amp;&quot;&gt;");
    expect(strFromU8(files["icons/GlyphShape1.tsx"])).toContain("<path");
  });
});

function memoryJobs(): ExportJobStore {
  const jobs = new Map<string, ExportJob>();
  const sources = new Map<string, ExportRequest>();
  const files = new Map<string, NonNullable<Awaited<ReturnType<ExportJobStore["artifact"]>>>>();
  return {
    async create(job, source) { jobs.set(job.id, job); sources.set(job.id, source); },
    async get(id) { return jobs.get(id) ?? null; },
    async snapshot(id) { return sources.get(id) ?? null; },
    async artifact(id) { return files.get(id) ?? null; },
    async finish(job, status, file) {
      if (jobs.get(job.id)?.state !== "queued") return false;
      jobs.set(job.id, { ...job, ...status });
      if (file) files.set(job.id, file);
      sources.delete(job.id);
      return true;
    },
    async pending(before) { return [...jobs.values()].filter(job => job.state === "queued" && job.createdAt <= before).map(job => job.id); },
  };
}

const origin = "http://localhost";
function submit(body: ExportRequest) {
  return { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function api(userId: string | null, store = memoryJobs(), enabled = false) {
  const enqueue = vi.fn(async () => undefined);
  const app = createApi({
    identify: async (c, next) => { c.set("userId", userId); await next(); },
    limit: async () => null,
    exports: {
      store, enqueue, canQueue: () => enabled,
      findCollection: async ownerId => ownerId === "owner" ? { name: studio.name, kind: studio.kind } : null,
    },
  });
  return { app, enqueue, store };
}

describe("export jobs and access boundaries", () => {
  it("queues a private snapshot and publishes a downloadable WOFF2 once", async () => {
    const { app, enqueue, store } = api("owner", memoryJobs(), true);
    const input = { ...request, collectionId, format: "woff2" as const };
    const accepted = await app.request(origin + "/api/exports", submit(input));
    expect(accepted.status).toBe(202);
    const { id } = await accepted.json() as { id: string };
    expect(enqueue).toHaveBeenCalledWith(id);
    expect(await store.pending(Date.now())).toEqual([id]);
    const location = origin + "/api/exports/" + id;
    const outsider = api("other", store, true).app;
    expect((await outsider.request(location)).status).toBe(404);
    expect((await outsider.request(location + "/download")).status).toBe(404);
    expect(await runExportJob(id, { store })).toEqual({ state: "ready" });
    expect(await runExportJob(id, { store, compile: async () => { throw Error("Already built"); } })).toEqual({ state: "ready" });
    expect(await store.snapshot(id)).toBeNull();
    expect(await store.pending(Date.now())).toEqual([]);
    const download = await app.request(location + "/download");
    expect(download.headers.get("Content-Type")).toBe("font/woff2");
    expect(String.fromCharCode(...new Uint8Array(await download.arrayBuffer()).slice(0, 4))).toBe("wOF2");
  }, 20000);

  it("supports immediate guest output and validates export ownership and input", async () => {
    const { app } = api(null);
    const body = { ...request, format: "svg" as const };
    const direct = await app.request(origin + "/api/exports", submit(body));
    expect(direct.status).toBe(200);
    expect(direct.headers.get("Content-Disposition")).toContain("-sprite.svg");
    expect((await app.request(origin + "/api/exports", submit({ ...body, collectionId }))).status).toBe(401);
    expect((await app.request(origin + "/api/exports", {
      ...submit(body), headers: { Origin: "https://other.test", "Content-Type": "application/json" },
    })).status).toBe(403);
    const invalid = { ...body, glyphs: [{ ...body.glyphs[0], paths: ["M0 0 X2 2"] }], kerning: [] };
    expect((await app.request(origin + "/api/exports", submit(invalid))).status).toBe(422);
  });

  it("matches the public browser origin when Next uses an internal listen host", async () => {
    const { app } = api(null);
    const body = { ...request, format: "svg" as const };
    const inbound = "http://127.0.0.1:3211";
    const response = await app.request("http://localhost:3211/api/exports", {
      ...submit(body),
      headers: { Origin: inbound, Host: "127.0.0.1:3211", "Content-Type": "application/json" },
    });
    expect(response.status).toBe(200);
  });

  it("surfaces permanent draft validation errors without storing a file", async () => {
    const store = memoryJobs();
    const id = crypto.randomUUID();
    await store.create({ id, ownerId: "owner", createdAt: Date.now(), state: "queued" }, request);
    const compile = async () => { throw new ExportInputError("Invalid outline."); };
    expect(await runExportJob(id, { store, compile })).toEqual({ state: "failed" });
    expect(await store.get(id)).toMatchObject({ state: "failed", message: "Invalid outline." });
    expect(await store.artifact(id)).toBeNull();
  });
});
