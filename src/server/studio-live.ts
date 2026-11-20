import { Redis } from "@upstash/redis";
import type { StudioLiveEvent, StudioPresence, StudioReceipt } from "../lib/foundry/sync-contract";

const prefix = "glyph:live:v1:";
const channel = (id: string) => prefix + id + ":events";
const presenceKey = (id: string) => prefix + id + ":presence";
export const presenceLifetime = 45_000;

export interface StudioLive {
  publishRevision(id: string, receipt: StudioReceipt): Promise<void>;
  announce(id: string, entry: StudioPresence): Promise<boolean>;
  roster(id: string): Promise<StudioPresence[]>;
  subscribe(id: string, listener: (event: StudioLiveEvent) => void): { ready: Promise<void>; close: () => void };
}

let redis: Redis | undefined;
const connection = () => redis ??= Redis.fromEnv();

export const studioLive: StudioLive = {
  async publishRevision(id, receipt) {
    await connection().publish(channel(id), JSON.stringify({ type: "revision", receipt }));
  },
  async announce(id, entry) {
    const accepted = await connection().eval<string[], number>(`
      local current = redis.call('HGETALL', KEYS[1])
      for i=1,#current,2 do
        if cjson.decode(current[i+1]).expiresAt <= tonumber(ARGV[3]) then
          redis.call('HDEL', KEYS[1], current[i])
        end
      end
      if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 and redis.call('HLEN', KEYS[1]) >= 32 then
        return 0
      end
      redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
      redis.call('EXPIRE', KEYS[1], 60)
      redis.call('PUBLISH', KEYS[2], ARGV[4])
      return 1
    `, [presenceKey(id), channel(id)], [
      entry.clientId, JSON.stringify(entry), String(Date.now()), JSON.stringify({ type: "presence", entry }),
    ]);
    return accepted === 1;
  },
  async roster(id) {
    const entries = await connection().hgetall<Record<string, StudioPresence>>(presenceKey(id));
    const now = Date.now();
    return Object.values(entries ?? {}).filter(entry => entry.expiresAt > now);
  },
  subscribe(id, listener) {
    const subscription = connection().subscribe<StudioLiveEvent>(channel(id));
    let done: () => void = () => {};
    const ready = new Promise<void>(resolve => { done = resolve; });
    subscription.on("subscribe", done);
    subscription.on("error", done);
    subscription.on("message", event => listener(event.message));
    return {
      ready,
      close() { done(); void subscription.unsubscribe(); },
    };
  },
};
