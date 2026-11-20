import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const info = { name: "glyph-foundry", version: "0.1.0" };
let url;
try {
  url = new URL(process.env.GLYPH_MCP_URL ?? "https://glyph-chan.vercel.app/api/mcp");
} catch {
  console.error("GLYPH_MCP_URL must be a valid URL.");
  process.exit(1);
}
const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
if (!(url.protocol === "https:" || (url.protocol === "http:" && local)) || url.username || url.password || url.hash || url.search) {
  console.error("GLYPH_MCP_URL must use HTTPS or local HTTP.");
  process.exit(1);
}
const secret = process.env.GLYPH_MCP_TOKEN;
if (!secret || !/^glyph_mcp_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(secret)) {
  console.error("Set GLYPH_MCP_TOKEN to the collection token from Glyph Studio.");
  process.exit(1);
}

let remote;
function connectRemote() {
  if (!remote) {
    const client = new Client({ ...info, name: "glyph-stdio" });
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: "Bearer " + secret }, redirect: "error" },
    });
    remote = client.connect(transport).then(() => client).catch(error => {
      remote = undefined;
      void client.close();
      throw error;
    });
  }
  return remote;
}

serveStdio(() => {
  const server = new Server(info, { capabilities: { resources: {}, tools: {} } });
  server.setRequestHandler("tools/list", async request => (await connectRemote()).listTools(request.params));
  server.setRequestHandler("tools/call", async request => (await connectRemote()).callTool(request.params));
  server.setRequestHandler("resources/list", async request => (await connectRemote()).listResources(request.params));
  server.setRequestHandler("resources/templates/list", async request => (await connectRemote()).listResourceTemplates(request.params));
  server.setRequestHandler("resources/read", async request => (await connectRemote()).readResource(request.params));
  return server;
}, { onerror: () => console.error("Glyph MCP bridge could not process a stdio message.") });
