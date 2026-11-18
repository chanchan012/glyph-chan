import { handle } from "hono/vercel";
import { createApi } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handle(createApi());
