import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 2,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3211",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3211",
    url: "http://127.0.0.1:3211/api/health",
    reuseExistingServer:false,
    timeout:120000,
    env: {NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:"",CLERK_SECRET_KEY:"",UPSTASH_REDIS_REST_URL:"",UPSTASH_REDIS_REST_TOKEN:""},
  },
});
