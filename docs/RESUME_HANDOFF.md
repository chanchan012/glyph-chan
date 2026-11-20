# Resume Glyph

## Run locally

Use Node 24 and npm. From the repository root, run `npm ci`, then `npm run dev`. Open `http://localhost:3000`. The public guest demo works with a blank environment.

Copy `.env.example` to `.env.local` for local services. Vercel Production already has Clerk development-instance credentials, the shared `kinora` Redis endpoint and token, and the restricted Neon runtime connection. Use separate service credentials if enabling Preview integrations. Redeploy after changing Vercel variables because Next.js binds public Clerk configuration at build time.

| Variable | Source and use |
| --- | --- |
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | Clerk application → API keys → publishable key |
| CLERK_SECRET_KEY | Same Clerk instance → secret key, server only |
| NEXT_PUBLIC_CLERK_SIGN_IN_URL | /sign-in |
| NEXT_PUBLIC_CLERK_SIGN_UP_URL | /sign-up |
| DATABASE_URL | Neon branch → Connect → Postgres connection URI including required TLS settings |
| UPSTASH_REDIS_REST_URL | Upstash Redis database → REST API endpoint |
| UPSTASH_REDIS_REST_TOKEN | Same Redis database → read/write REST token, server only |
| INNGEST_EVENT_KEY | Inngest → Manage → Event Keys, server only |
| INNGEST_SIGNING_KEY | Inngest → Manage → Signing Key, server only |

Use a domain whose DNS you control to activate Clerk production credentials. Both Clerk keys and Redis credentials are needed for authenticated RPC. The initial migration is already applied to `glyph` in Neon project `still-bird-86777802`. For future migrations, run `npm run db:migrate` with the migration owner's connection string for the intended database. The command loads .env.local and uses DATABASE_URL. Generate migrations after schema changes with `npm run db:generate`.

For local jobs, set `INNGEST_DEV=1`, run the Next.js app, and run `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest` with a development database configured. To enable hosted jobs, add both Inngest keys in Vercel Production, redeploy, and sync `https://glyph-chan.vercel.app/api/inngest` in the same Inngest environment. Verify that a new collection triggers `render-collection-thumbnail` and that its saved preview appears. The hosted credentials are user-managed.

## Acceptance commands

1. Run `npm run typecheck` and `npm test`.
2. Run `npx playwright install chromium` once and `npm run test:e2e`. On Windows with Edge installed, set `$env:PLAYWRIGHT_CHANNEL='msedge'` to use it. Playwright builds the production bundle and starts its own guest-only server on port 3211.
3. Run `npm run build`. Verify deployment in Vercel. Test live sign-in and member RPC after configuring credentials.

## Next subgoal

Resume from the tested foundation on [GitHub main](https://github.com/chanchan012/glyph-chan/tree/main). Open the [production guest demo](https://glyph-chan.vercel.app/demo) to inspect the shell. Manage keys for the linked deployment in [Vercel environment settings](https://vercel.com/chanchans-projects-aada625f/glyph-chan/settings/environment-variables). After setting credentials and redeploying, sign in and request /api/account in the same browser. Verify that the response contains your Clerk user ID and that the Redis limiter records the request.

Open `/studio/demo` to resume editing a guest draft, or select a member collection from the dashboard. Use the Inspector to edit bearings and optical guides, combine contours, or paste canonical SVG path data. Drafts are stored locally until shared autosave is implemented in M4.1.

Branch from main for 3.1. Build the waterfall preview, kerning editor, and optical stroke-weight analyzer on the existing `GlyphFoundryState`. Apply explicit pair adjustments to advance positions and preview the actual edited contours. Keep guide coordinates SVG y-down and metrics in font units. Add Vitest coverage for pair positioning, spacing, and stem width, plus browser coverage for preview and editor interaction. Later milestones and their order are listed in PROGRESS.md.
