import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "../../src/server/api";
import { clerkKeys } from "../../src/server/config";

const permit = async () => ({ success:true, reset:Date.now()+60000 });
function apiFor(userId: string | null, limit = vi.fn(permit)) {
  return createApi({identify: async(c,next)=>{c.set("userId",userId);await next()},limit});
}
afterEach(()=>vi.unstubAllEnvs());
function guestEnvironment(){
  for(const key of ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY","CLERK_SECRET_KEY","UPSTASH_REDIS_REST_URL","UPSTASH_REDIS_REST_TOKEN"])vi.stubEnv(key,"");
}
describe("Hono RPC", ()=>{
  it("serves read-only guests with no providers configured",async()=>{
    guestEnvironment();
    const app=createApi();
    expect(await (await app.request("/api/health")).json()).toEqual({status:"ok",service:"glyph"});
    const session=await app.request("/api/session",{headers:{"x-user-id":"user_forged",authorization:"Bearer invalid"}});
    expect(await session.json()).toEqual({mode:"guest"});
    expect(session.headers.get("Cache-Control")).toContain("no-store");
    expect((await app.request("/api/account")).status).toBe(401);
  });
  it("uses the verified identity for the private account and limiter",async()=>{
    const limit=vi.fn(permit);
    const app=apiFor("user_test",limit);
    expect(await (await app.request("/api/session")).json()).toEqual({mode:"member",userId:"user_test"});
    expect(await (await app.request("/api/account")).json()).toEqual({userId:"user_test"});
    expect(limit).toHaveBeenCalledWith("user:user_test");
  });
  it("returns a retry interval when the quota is exceeded",async()=>{
    const app=apiFor(null,vi.fn(async()=>({success:false,reset:Date.now()+30000})));
    const result=await app.request("/api/session");
    expect(result.status).toBe(429);
    expect(Number(result.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
  it("fails closed when the live limiter is unavailable",async()=>{
    const app=apiFor("user_test",vi.fn(async()=>{throw Error("offline")}));
    expect((await app.request("/api/account")).status).toBe(503);
  });
  it("rejects incomplete provider credentials",async()=>{
    guestEnvironment();vi.stubEnv("UPSTASH_REDIS_REST_URL","https://example.invalid");
    expect((await createApi().request("/api/health")).status).toBe(503);
    vi.stubEnv("CLERK_SECRET_KEY","incomplete");
    expect(()=>clerkKeys()).toThrow("both Clerk keys");
  });
  it("ignores client-supplied forwarding headers outside Vercel",async()=>{
    vi.stubEnv("VERCEL","");
    const limit=vi.fn(permit);
    await apiFor(null,limit).request("/api/session",{headers:{"x-forwarded-for":"fake","x-vercel-forwarded-for":"fake"}});
    expect(limit).toHaveBeenCalledWith("guest:shared");
  });
});
