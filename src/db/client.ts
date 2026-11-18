import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function connectDatabase() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for persistence.");
  return drizzle(neon(process.env.DATABASE_URL), { schema });
}
