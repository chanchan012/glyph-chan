import { handle } from "hono/vercel";
import { createMcpHttp } from "@/server/mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const handler = handle(createMcpHttp());
export { handler as POST, handler as GET, handler as DELETE };
