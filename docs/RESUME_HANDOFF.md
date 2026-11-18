# Resume Glyph

## Run locally

Use Node 24 and npm. From the repository root, run `npm ci`, then `npm run dev`. Open `http://localhost:3000`. The public guest demo works with a blank environment.

Copy `.env.example` to `.env.local` for local services. In Vercel set the corresponding values under the project's Environment Variables, use separate preview and production credentials, then redeploy. Next.js binds public Clerk configuration at build time.

| Variable | Source and use |
| --- | --- |
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | Clerk application → API keys → publishable key |
| CLERK_SECRET_KEY | Same Clerk instance → secret key, server only |
| NEXT_PUBLIC_CLERK_SIGN_IN_URL | /sign-in |
| NEXT_PUBLIC_CLERK_SIGN_UP_URL | /sign-up |
| DATABASE_URL | Neon branch → Connect → Postgres connection URI including required TLS settings |
| UPSTASH_REDIS_REST_URL | Upstash Redis database → REST API endpoint |
| UPSTASH_REDIS_REST_TOKEN | Same Redis database → read/write REST token, server only |

Configure Clerk's production domain for the deployed site. Both Clerk keys and Redis credentials are needed for authenticated RPC. Run `npm run db:migrate` against the intended Neon branch before enabling persistence. The command loads .env.local and uses DATABASE_URL. Generate migrations only after schema changes with `npm run db:generate`.

## Acceptance commands

1. Run `npm run typecheck` and `npm test`.
2. Run `npx playwright install chromium` once and `npm run test:e2e`. On Windows with Edge installed, set `$env:PLAYWRIGHT_CHANNEL='msedge'` to use it. Playwright starts its own guest-only server on port 3211.
3. Run `npm run build`. Verify deployment in Vercel. Test live sign-in and member RPC after configuring credentials.

## Next subgoal

Resume from the tested foundation on [GitHub main](https://github.com/chanchan012/glyph-chan/tree/main). Open the [production guest demo](https://glyph-chan.vercel.app/demo) to inspect the shell. The [Vercel environment settings](https://vercel.com/chanchans-projects-aada625f/glyph-chan/settings/environment-variables) belong to the linked deployment project. After setting credentials and redeploying, sign in and request /api/account in the same browser. Verify that the response contains your Clerk user ID and that the Redis limiter records the request. Apply the migration to the intended Neon branch and verify the three tables before starting dashboard persistence.

Branch from main for 1.2. Give the 3–5 bullet brief, implement owner-scoped dashboard CRUD for typefaces and icon sets, connect the landing shell, and wire Inngest specimen thumbnails. Use separate test database data, cover CRUD and job behavior in Vitest, and cover dashboard grid and viewport geometry in Playwright. Merge after tests, build, deploy and update all three handoff documents. Later milestones and their order are listed in PROGRESS.md.
