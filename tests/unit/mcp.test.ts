import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { issueAgentToken } from "../../src/server/mcp/credentials";
import { createMcpHttp, type McpHttpServices } from "../../src/server/mcp/http";
import { foundryRuntime } from "../support/foundry-runtime";

const hostname = "http://localhost";
const endpoint = new URL("/api/mcp", hostname);
const owner = "clerk-designer";
const path = "M 15 -10 C 15 -450 280 -620 540 -560 L 450 -10 Z";
let runtime: Awaited<ReturnType<typeof foundryRuntime>>;
beforeAll(async () => { runtime = await foundryRuntime(); }, 30_000);
afterAll(() => runtime?.close());

function connect(token: string, changes: McpHttpServices = {}) {
  const api = createMcpHttp({ ...runtime, limit: async () => null, ...changes });
  const client = new Client({ name: "glyph-vitest", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: "Bearer " + token } },
    fetch: async (input, init) => api.fetch(new Request(input, init)),
  });
  return { client, api, ready: client.connect(transport) };
}

it("issues and rotates scoped credentials and denies foreign owners, browser origins, and expired tokens", async () => {
  const id = await runtime.collection(owner);
  const path = "/api/collections/" + id + "/mcp-token";
  function change(user: string | null, method: string, origin = hostname) {
    return runtime.browserApi(user).request(new URL(path, hostname), {
      method, headers: { Origin: origin, "Content-Type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify({ label: "Font agent" }) } : {}),
    });
  }
  expect((await change(null, "POST")).status).toBe(401);
  expect((await change("other", "POST")).status).toBe(404);
  expect((await change(owner, "POST", "https://untrusted.example")).status).toBe(403);
  const issued = await change(owner, "POST");
  expect(issued.status).toBe(201);
  expect(issued.headers.get("cache-control")).toContain("no-store");
  const one = await issued.json();
  expect((await change(owner, "GET")).status).toBe(200);
  expect(await (await change(owner, "GET")).json()).toEqual({ agent: one.agent });
  expect(JSON.stringify(await runtime.credentials.get(id))).not.toContain(one.token.split(".")[1]);
  const two = await (await change(owner, "POST")).json();
  const http = createMcpHttp({ ...runtime, limit: async () => null });
  const req = (token?: string, origin?: string) => http.request(endpoint, {
    method: "POST", headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(origin ? { Origin: origin } : {}) },
  });
  expect((await req()).status).toBe(401);
  expect((await req(one.token)).status).toBe(401);
  expect((await req(two.token, "https://untrusted.example")).status).toBe(403);
  const credential = (await runtime.credentials.get(id))!;
  await runtime.credentials.set({ ...credential, expiresAt: Date.now() - 1 });
  expect((await req(two.token)).status).toBe(401);
  const three = await (await change(owner, "POST")).json();
  expect((await change(owner, "DELETE")).status).toBe(204);
  expect((await req(three.token)).status).toBe(401);
  const { token } = await issueAgentToken(runtime.credentials, owner, id, "Rate-limited agent");
  const busy = createMcpHttp({ ...runtime, limit: async () => ({ success: false, reset: Date.now() + 1000 }) });
  const limited = await busy.request(endpoint, { method: "POST", headers: { Authorization: "Bearer " + token } });
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("1");
});

it("serves all named resources and tools through a real MCP client and persists attributed edits", async () => {
  const id = await runtime.collection(owner);
  const other = await runtime.collection(owner);
  const { token } = await issueAgentToken(runtime.credentials, owner, id, "Foundry test agent");
  const { client, ready } = connect(token);
  try {
    await ready;
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual([
      "apply_boolean_operation", "audit_optical_consistency", "create_glyph", "draw_bezier_contours",
      "export_svg_icons", "set_glyph_metrics", "set_kerning_pair", "transform_contours", "trigger_woff2_compile",
    ]);
    expect((await client.listResourceTemplates()).resourceTemplates[0].uriTemplate).toBe("glyph://glyph/{char}/paths");
    const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    async function json(uri: string) {
      const first = (await client.readResource({ uri })).contents[0];
      if (!("text" in first)) throw Error("Resource did not return JSON text.");
      return JSON.parse(first.text);
    }

    expect(await json("glyph://foundry-metrics")).toMatchObject({ revision: 0, unitsPerEm: 1000, strokeTargets: { stemReference: null } });
    expect(await call("create_glyph", { glyph: "Á", expectedRevision: 0 })).toMatchObject({ structuredContent: { revision: 1 } });
    expect(await call("create_glyph", { glyph: "V", expectedRevision: 0 })).toMatchObject({ isError: true, structuredContent: { revision: 1 } });
    expect(await call("create_glyph", { glyph: "V" })).toMatchObject({ structuredContent: { revision: 2 } });
    const requestId = crypto.randomUUID();
    const draw = { glyph: "Á", paths: [path, "M 30 -150 L 180 -150 L 180 20 L 30 20 Z"], expectedRevision: 2, requestId };
    expect(await call("draw_bezier_contours", draw)).toMatchObject({ structuredContent: { revision: 3, receipt: { actor: { kind: "agent", label: "Foundry test agent" } } } });
    expect(await call("draw_bezier_contours", draw)).toMatchObject({ structuredContent: { revision: 3, replay: true } });
    expect(await call("draw_bezier_contours", { glyph: "V", paths: ["M 0 0 Q 150 -520 420 0 Z"] })).toMatchObject({ structuredContent: { revision: 4 } });
    expect(await call("apply_boolean_operation", { glyph: "Á", operation: "union", subject: [0], clip: [1] })).toMatchObject({ structuredContent: { revision: 5 } });
    expect(await call("transform_contours", { glyph: "Á", matrix: [0.9, 0, 0, 0.85, 2, 7] })).toMatchObject({ structuredContent: { revision: 6 } });
    expect(await call("set_glyph_metrics", { glyph: "Á", advanceWidth: 630, leftBearing: 40, rightBearing: 35 })).toMatchObject({ structuredContent: { revision: 7 } });
    expect(await call("set_kerning_pair", { left: "Á", right: "V", adjustment: -45, anchor: { contour: 1, index: 0 } }))
      .toMatchObject({ isError: true });
    expect(await call("set_kerning_pair", { left: "Á", right: "V", adjustment: -45, anchor: { contour: 0, index: 0 } }))
      .toMatchObject({ structuredContent: { revision: 8 } });

    expect((await client.listResources()).resources.map(item => item.uri)).toEqual(expect.arrayContaining(["glyph://foundry-metrics", "glyph://kerning-table", "glyph://glyph/%C3%81/paths"]));
    const glyph = await json("glyph://glyph/%C3%81/paths");
    expect(glyph).toMatchObject({ revision: 8, key: "Á", metrics: { advanceWidth: 630 }, contours: [{ start: { x: expect.any(Number), y: expect.any(Number) } }] });
    expect(glyph.paths[0]).toContain("C");
    expect(await json("glyph://kerning-table")).toMatchObject({ revision: 8, pairs: [{ left: "Á", right: "V", adjustment: -45 }] });
    expect(await call("audit_optical_consistency", { stemTarget: 70 })).toMatchObject({ structuredContent: { stemReference: 70, rows: [{ key: "V" }, { key: "Á" }] } });
    const woff = await call("trigger_woff2_compile");
    expect(woff).toMatchObject({ structuredContent: { revision: 8, state: "ready", filename: "shared-specimen.woff2" } });
    const { base64 } = woff.structuredContent as { base64: string };
    expect(Buffer.from(base64, "base64").subarray(0, 4).toString()).toBe("wOF2");
    expect(await runtime.repository.load(owner, other)).toMatchObject({ syncRevision: 0, glyphs: [] });
    expect(await runtime.live.roster(id)).toMatchObject([{
      actor: { kind: "agent", label: "Foundry test agent" }, glyph: "Á", anchor: { contour: 0, index: 0 },
    }]);
  } finally {
    await client.close();
  }
}, 30_000);

it("packages icons and queues WOFF2 against the saved revision when Inngest is configured", async () => {
  const iconId = await runtime.collection(owner, "icon_set");
  const { token: iconToken } = await issueAgentToken(runtime.credentials, owner, iconId, "Icon agent");
  const icons = connect(iconToken);
  try {
    await icons.ready;
    await icons.client.callTool({ name: "create_glyph", arguments: { glyph: "mark" } });
    await icons.client.callTool({ name: "draw_bezier_contours", arguments: { glyph: "mark", paths: [path] } });
    expect(await icons.client.callTool({ name: "export_svg_icons", arguments: {} })).toMatchObject({
      structuredContent: { revision: 2, svg: expect.stringContaining("<symbol") },
    });
    expect(await icons.client.callTool({ name: "trigger_woff2_compile", arguments: {} })).toMatchObject({ isError: true });
  } finally {
    await icons.client.close();
  }

  const fontId = await runtime.collection(owner);
  const { token: fontToken } = await issueAgentToken(runtime.credentials, owner, fontId, "Font agent");
  const jobId = crypto.randomUUID();
  const queue = vi.fn(async () => ({ id: jobId, state: "queued" as const }));
  const get = vi.fn(async (id: string) => ({
    id, state: "ready" as const, ownerId: owner, createdAt: Date.now(), format: "woff2" as const,
    collectionId: id === jobId ? fontId : iconId, filename: "build.woff2", contentType: "font/woff2",
  }));
  const artifact = vi.fn(async () => ({ filename: "build.woff2", contentType: "font/woff2", data: "d09GMg==" }));
  const font = connect(fontToken, { canQueue: () => true, queue, jobs: { get, artifact } });
  try {
    await font.ready;
    expect(await font.client.callTool({ name: "trigger_woff2_compile", arguments: {} })).toMatchObject({
      structuredContent: { id: jobId, state: "queued", revision: 0, statusPath: "/api/exports/" + jobId },
    });
    expect(queue).toHaveBeenCalledWith(owner, expect.objectContaining({ collectionId: fontId, format: "woff2" }));
    expect(await font.client.callTool({ name: "trigger_woff2_compile", arguments: { jobId: crypto.randomUUID() } }))
      .toMatchObject({ isError: true });
    expect(artifact).not.toHaveBeenCalled();
    expect(await font.client.callTool({ name: "trigger_woff2_compile", arguments: { jobId } })).toMatchObject({
      structuredContent: { id: jobId, state: "ready", base64: "d09GMg==" },
    });
  } finally {
    await font.client.close();
  }
}, 25_000);
