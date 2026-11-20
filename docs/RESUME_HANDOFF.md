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

Use a domain whose DNS you control to activate Clerk production credentials. Both Clerk keys and Redis credentials are needed for authenticated RPC. Migrations through `0002_supreme_kate_bishop` are applied to `glyph` in Neon project `still-bird-86777802`. For future migrations, run `npm run db:migrate` with the migration owner's connection string for the intended database. The command loads .env.local and uses DATABASE_URL. Generate migrations after schema changes with `npm run db:generate`.

For local jobs, set `INNGEST_DEV=1`, run the Next.js app, and run `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest` with development Neon and Upstash credentials. To enable hosted jobs, add both Inngest keys in Vercel Production, redeploy, and sync `https://glyph-chan.vercel.app/api/inngest` in the same Inngest environment. Verify that a new collection triggers `render-collection-thumbnail` and that a member WOFF2 export triggers `compile-collection-export`. The hosted credentials are user-managed.

## Acceptance commands

1. Run `npm run typecheck` and `npm test`.
2. Run `npx playwright install chromium` once and `npm run test:e2e`. On Windows with Edge installed, set `$env:PLAYWRIGHT_CHANNEL='msedge'` to use it. Playwright builds the production bundle and starts its own guest-only server on port 3211.
3. Run `npm run build`. Verify deployment in Vercel. A production smoke test already verified Clerk, member RPC, Neon autosave, Redis presence, and MCP edits and revocation.

## Use the deployed studio

The implementation is on [GitHub main](https://github.com/chanchan012/glyph-chan/tree/main). Open the [production guest demo](https://glyph-chan.vercel.app/demo) or sign in to create and edit private collections. Manage Inngest activation in [Vercel environment settings](https://vercel.com/chanchans-projects-aada625f/glyph-chan/settings/environment-variables).

Open `/studio/demo` to resume a guest draft, or select a member collection from the dashboard. Use the Inspector to edit bearings and optical guides, combine contours, or paste canonical SVG path data. Member drafts autosave to Neon. Open the same collection in two signed-in tabs to see shared edits and active anchors.

Open Specimen in a typeface studio to proof outlines at five sizes, preview and save kerning adjustments, or inspect stem widths and overshoot. Member autosave includes kerning, outlines, and metrics in one revision.

Use Export in the studio to download WOFF2, TrueType, an SVG sprite, a React ZIP, or a specimen SVG. Background jobs are owner-scoped and the last job can be reopened in the same browser tab. Direct compilation remains available while hosted Inngest waits for keys and sync.

## Connect an MCP client

1. Sign in, open a collection, and select **Agent access**. Give the agent a name and copy its token. A collection supports one active token, which expires seven days after creation.
2. For Streamable HTTP, use `https://glyph-chan.vercel.app/api/mcp` with `Authorization: Bearer <token>`.
3. For stdio, configure the client to run `node scripts/glyph-mcp.mjs` from a checkout after `npm ci`. Set `GLYPH_MCP_URL` and `GLYPH_MCP_TOKEN` in the client environment. Keep the bearer token out of version control and revoke or rotate it from Agent access.
4. Read `glyph://foundry-metrics` and a glyph path resource before mutating. Pass the observed revision as `expectedRevision` and a fresh UUID as `requestId`. Save a returned Inngest job ID, then call `trigger_woff2_compile` with `jobId` to check status and retrieve the artifact.

## Remaining verification

The user manages `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`. Once both are added to Vercel Production, redeploy and sync the hosted Inngest endpoint. Create a disposable collection and verify the thumbnail worker succeeds. Add an outlined glyph and verify a member WOFF2 export moves from queued to ready and yields a file beginning with `wOF2`. Direct exports and local worker tests are already verified.
