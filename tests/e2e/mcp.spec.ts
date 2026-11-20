import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "@playwright/test";
import { parsePath } from "../../src/lib/vector/svg";
import { transformContour, type Contour } from "../../src/lib/vector/types";
import { createMcpHttp } from "../../src/server/mcp/http";
import { foundryRuntime } from "../support/foundry-runtime";

test("an MCP agent derives lowercase glyphs from uppercase contours and the open studio updates", async ({ page, baseURL }) => {
  const runtime = await foundryRuntime();
  const owner = "collaborating-designer";
  const id = await runtime.collection(owner);
  const metrics = { unitsPerEm: 1000, ascender: 800, descender: -200, capHeight: 700, xHeight: 525 };
  const glyphMetrics = { advanceWidth: 640, leftBearing: 50, rightBearing: 45 };
  const upper = [
    { key: "A", paths: ["M 50 0 L 285 -700 L 355 -700 L 590 0 Z"], metrics: glyphMetrics },
    { key: "V", paths: ["M 50 -700 L 215 -700 C 240 -450 285 -280 320 -210 L 485 -700 L 590 -700 L 365 0 L 275 0 Z"], metrics: glyphMetrics },
  ];
  await runtime.repository.save(owner, id, { kind: "human", id: owner, label: "Designer" }, {
    requestId: crypto.randomUUID(), expectedRevision: 0, snapshot: { metrics, glyphs: upper, kerning: [] },
  });
  const browser = runtime.browserApi(owner);
  const agent = createMcpHttp({ ...runtime, limit: async () => null });
  const server = serve({
    hostname: "127.0.0.1", port: 0, overrideGlobalObjects: false,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/mcp") return agent.fetch(req);
      if (url.pathname.startsWith("/api/collections")) return browser.fetch(req);
      // The test fixture owns auth and data. The production Next build supplies the page and browser bundles.
      const upstream = await fetch(new URL(url.pathname + url.search, baseURL), { redirect: "manual" });
      const headers = new Headers(upstream.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(upstream.body, { status: upstream.status, headers });
    },
  });
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const endpoint = new URL("/api/mcp", origin);
  const http = new Client({ name: "glyph-browser-test-http", version: "1.0.0" });
  const stdio = new Client({ name: "glyph-browser-test-agent", version: "1.0.0" });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + "/studio/" + id);
    await expect(page.getByText("Saved to collection")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shared specimen" })).toBeVisible();
    await page.getByRole("button", { name: "Agent access" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect an agent" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Agent name").fill("Optical assistant");
    await dialog.getByRole("button", { name: "Create token" }).click();
    await expect(dialog.getByLabel("Bearer token")).toHaveValue(/^glyph_mcp_/);
    const token = await dialog.getByLabel("Bearer token").inputValue();
    await expect(dialog.getByLabel("Streamable HTTP endpoint")).toHaveValue(endpoint.href);
    expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]))
      .toEqual([390, 844]);
    await dialog.getByRole("button", { name: "Close agent access" }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("glyph-path")).toBeVisible();

    await http.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: "Bearer " + token } } }));
    expect((await http.listTools()).tools).toHaveLength(9);
    await stdio.connect(new StdioClientTransport({
      command: process.execPath, args: ["scripts/glyph-mcp.mjs"], cwd: process.cwd(),
      env: { GLYPH_MCP_URL: endpoint.href, GLYPH_MCP_TOKEN: token }, stderr: "pipe",
    }));
    expect((await stdio.listResourceTemplates()).resourceTemplates[0].uriTemplate).toBe("glyph://glyph/{char}/paths");
    const read = async (uri: string) => {
      const item = (await stdio.readResource({ uri })).contents[0];
      if (!("text" in item)) throw Error("Expected resource text.");
      return JSON.parse(item.text);
    };
    const guides = await read("glyph://foundry-metrics") as { xHeight: number; capHeight: number; revision: number };
    const scale = guides.xHeight / guides.capHeight;
    let revision = guides.revision;
    for (const { key } of upper) {
      const blueprint = await read("glyph://glyph/" + key + "/paths") as { contours: Contour[] };
      const lower = key.toLowerCase();
      const create = await stdio.callTool({ name: "create_glyph", arguments: { glyph: lower, expectedRevision: revision } });
      expect(create).toMatchObject({ structuredContent: { revision: ++revision } });
      const contours = blueprint.contours.map(contour => transformContour(contour, [scale, 0, 0, scale, 0, 0]));
      const draw = await stdio.callTool({ name: "draw_bezier_contours",
        arguments: { glyph: lower, contours, expectedRevision: revision, anchor: { contour: 0, index: 0 } } });
      expect(draw).toMatchObject({ structuredContent: { revision: ++revision } });
    }
    await page.getByRole("button", { name: "Select glyph v", exact: true }).click();
    await expect(page.getByTestId("glyph-path")).toHaveAttribute("d", /M 37\.5 -525 C|M 37\.5 -525 L .* C /);
    await expect(page.getByTestId("peer-anchor")).toBeVisible();
    const roster = page.getByLabel("Live collaborators");
    await expect(roster).toContainText("Optical assistant · v");
    await expect(roster).toContainText("Edited by Optical assistant");
    const saved = await runtime.repository.load(owner, id);
    expect(saved).toMatchObject({ syncRevision: 5, receipts: expect.arrayContaining([
      expect.objectContaining({ revision: 5, actor: expect.objectContaining({ kind: "agent", label: "Optical assistant" }) }),
    ]) });
    for (const { key, paths } of upper) {
      const lower = saved?.glyphs.find(glyph => glyph.key === key.toLowerCase());
      expect(lower?.paths.flatMap(parsePath)).toEqual(paths.flatMap(parsePath).map(contour => transformContour(contour, [scale, 0, 0, scale, 0, 0])));
    }

    await page.getByRole("button", { name: "Agent access" }).click();
    await expect(dialog.getByRole("button", { name: "Revoke access" })).toBeVisible();
    await expect(dialog.getByLabel("Bearer token")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Revoke access" }).click();
    await expect(dialog.getByText("Agent access revoked.")).toBeVisible();
    await expect(http.listTools()).rejects.toThrow();
  } finally {
    await page.goto("about:blank").catch(() => {});
    await Promise.all([http.close(), stdio.close()]);
    await new Promise<void>(resolve => {
      server.close(() => resolve());
      if ("closeAllConnections" in server) server.closeAllConnections();
    });
    await runtime.close();
  }
});
