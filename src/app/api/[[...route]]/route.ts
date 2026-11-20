import { handle } from "hono/vercel";
import { createApi } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = handle(createApi());
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
