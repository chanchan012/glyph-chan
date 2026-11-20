import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { clerkKeys } from "./config";

type Decision = { success: boolean; reset: number };
export type RateLimit = (key: string) => Promise<Decision | null>;

let limiter: Ratelimit | undefined;
export const limitApi: RateLimit = async key => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url && !token && !clerkKeys()) return null;
  if (!url || !token) throw new Error("Rate limiter unavailable");
  limiter ??= new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(60, "1 m"),
    prefix: "glyph:api:v1",
  });
  const result = await limiter.limit(key);
  if (result.reason === "timeout") throw new Error("Rate limiter timed out");
  return result;
};

export function retryAfter(reset: number) {
  return String(Math.max(1, Math.ceil((reset - Date.now()) / 1000)));
}
