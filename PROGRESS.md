# Glyph progress

## M1.1 · Foundation and shell

The feature branch is `feat/foundation-shell`. The repository began empty. The implementation includes four viewport-locked public pages, read-only guest specimens, Clerk integration, typed Hono GET routes, Upstash’s sliding-window limiter and a versioned Neon schema.

Completed November 18, 2026. Feature commit `8104fd6` merged into `main` at `2dd73bb`. Both branches were published to [GitHub](https://github.com/chanchan012/glyph-chan).

| Verification | Result |
| --- | --- |
| Strict TypeScript and next build | Passed locally using Node 24 and Next.js 16.4.6 |
| Vitest | 6 passing RPC, auth-boundary, provider configuration and limiter tests |
| Playwright | 8 passing in headless Edge. All four pages fit 1440×900, 1024×768, 768×1024, 390×844, 320×568 and 844×390. Specimen switching, outline, guide toggling and guest navigation passed. |
| Production bundle | Local next start served the guest health endpoint and landing page. The rendered desktop layout was visually inspected. |
| Production dependencies | npm audit --omit=dev reported zero advisories. The full audit reported nine entries in development tooling, rooted in esbuild and picomatch. |
| Vercel production | READY at [glyph-chan.vercel.app](https://glyph-chan.vercel.app), deployment `dpl_5BfPZUyq7GVVYVQ29k7Nvecrx6Rc` |
| Vercel feature preview | READY at [feature preview](https://glyph-chan-mtkjhnk0o-chanchans-projects-aada625f.vercel.app), deployment `dpl_DSEn8eBH5crm8dM7uxqqg4Pqd7EK` |

The initial deployment was in guest mode.

## Provider setup · November 19, 2026

Created the `glyph` database on the production branch of Neon project `still-bird-86777802`. Applied migration `0000_eminent_ares` and verified its Drizzle ledger entry and the `collections`, `glyphs`, and `kerning_pairs` tables. Verified a Neon HTTP connection as `glyph_runtime` and CRUD grants on those three tables.

Configured Vercel Production with the dedicated Glyph Clerk development instance, the existing free `kinora` Upstash Redis database, and the pooled `glyph_runtime` connection. Clerk production credentials require a custom domain with DNS control. Preview deployments continue to serve the guest specimen lab.

Verified that the Clerk sign-in and sign-up forms render on the public site. Confirmed that unauthenticated account requests return 401, and that the live Upstash limiter returns 429 with Retry-After at 60 requests in the same guest window. The M4.2 production smoke test also verified an authenticated account request with the dedicated Glyph Clerk development instance.

## M1.2 · Collections and specimen thumbnails

Merged `feat/dashboard-collections` into `main` at `ca1ceff`. Production serves the [collections dashboard](https://glyph-chan.vercel.app/dashboard). Confirmed 200 for the dashboard and health endpoint and 401 for the anonymous collections API. The [feature preview](https://glyph-chan-4tmzpu2yg-chanchans-projects-aada625f.vercel.app/dashboard) was deployed separately.

Strict TypeScript, 11 Vitest cases, 14 Playwright cases, the production build, and the production dependency audit passed. The browser suite checks five dashboard viewports and exercises member CRUD against intercepted RPC responses. Vitest exercises owner isolation, origin and input validation, and the thumbnail job's rendering and stale-write handling.

Neon migration `0001_messy_jackpot` is applied. Verified the nullable `collections.thumbnail` column and runtime role's update grant. Hosted Inngest job execution awaits the user-managed keys and sync. The dashboard shows a local SVG specimen while a saved thumbnail is pending.

## M2.1 · Vector path and command engine

Merged `feat/vector-path-engine` into `main` at `9a40f94`. The engine implements canonical SVG contours, Bézier evaluation and splitting, exact extrema-based bounds, affine transforms, primitives, and curve-preserving Paper.js boolean operations. The command store supports deterministic replay, revision checks, and attributed undo and redo. The public specimen plate uses the shared parser.

Strict TypeScript, all 26 Vitest cases, all 14 Playwright cases, the production build, and the production dependency audit passed. One Playwright run lost its page context during navigation. The full rerun passed without an app change.

Vercel reported both the [production build](https://glyph-chan.vercel.app/demo) and the [feature preview](https://glyph-chan-hq4qnnsed-chanchans-projects-aada625f.vercel.app/demo) ready.

## M2.2 · Glyph studio

Merged `feat/studio-editor` into `main` at `9dbc1e8`. The [guest studio](https://glyph-chan.vercel.app/studio/demo) and [feature preview](https://glyph-chan-gashgrjsq-chanchans-projects-aada625f.vercel.app/studio/demo) are ready. Production returned 200 with the canvas rendered and 401 for an anonymous private studio request.

The studio has a glyph matrix, node and handle tools, line, quadratic and cubic pen modes, rectangle and ellipse tools, contour booleans, optical guides, metrics, SVG path entry, and undo and redo. Guests and members retain browser-local drafts by collection. The UI is linked from the specimen lab and dashboard. Server autosave is scheduled for M4.1.

Passed strict TypeScript, 28 Vitest cases, 23 Playwright cases against the production bundle, and the merged production build. Playwright covered anchor and handle dragging, quadratic drawing, rectangle union, metric edits, undo and redo, draft reload, mock member navigation, and six viewport sizes. The desktop and mobile layouts were visually inspected.

## M3.1 · Typeface proofing

Merged `feat/type-proofing` into `main` at `d819042`. The Specimen view is live in the [guest studio](https://glyph-chan.vercel.app/studio/demo) and on the [feature preview](https://glyph-chan-p8wfyh4yb-chanchans-projects-aada625f.vercel.app/studio/demo). A production browser smoke test opened the waterfall and verified its five sizes and default AV adjustment of −52 units.

Passed strict TypeScript, 34 Vitest cases, 25 Playwright cases, and the merged production build. Tests covered signed kerning, undo and redo, draft recovery, Unicode and fallback spacing, stem measurement through counters, overshoot tolerances, and mobile proofing. The local production view was visually inspected. The proof renders editable glyph outlines with direct pair positioning. Pair changes persist on the current device until shared autosave in M4.1.

## M3.2 · Font and icon exports

Merged `feat/font-and-icon-export` into `main` at `980c095`. The [production studio](https://glyph-chan.vercel.app/studio/demo) and [feature preview](https://glyph-chan-6oce8l51w-chanchans-projects-aada625f.vercel.app/studio/demo) are ready. A production browser smoke test downloaded `forma-serif.woff2` from the guest studio and verified its `wOF2` signature.

The studio exports TrueType, WOFF2, SVG sprites, React icon ZIPs, and specimen SVGs from the current draft. Inngest uses the existing Upstash instance for private compilation snapshots, status and expiring downloads. Direct compilation is available to guests and on deployments that await Inngest configuration. Hosted workers await the user-managed event and signing keys and app sync.

Passed 41 Vitest cases, 29 Playwright cases, the merged production build, and the production dependency audit. Tests verified SFNT tables, WOFF2 round-trip decoding, Chromium font loading and kerning, escaped SVG and React ZIP entries, job authorization and idempotence, and local Inngest worker registration.

## M4.1 · Live studio sync

Merged `feat/live-studio-sync` into `main` at `332c1f7`. Vercel reports the [production studio](https://glyph-chan.vercel.app/studio/demo) and [feature preview](https://glyph-chan-hkb01hyvk-chanchans-projects-aada625f.vercel.app/studio/demo) ready. Production returns 200 for the landing, Clerk sign-in, guest studio, and health routes, and 401 for anonymous studio read, save, stream, and presence calls.

Neon migration `0002_supreme_kate_bishop` added `collections.studio_revision` and `studio_receipts` and was recorded in the production Drizzle ledger. The existing runtime role can read the receipts and update revisions. Member studios save to Neon automatically, merge changes to separate records, surface overlaps for resolution, and preserve each tab's unresolved edits. Redis Pub/Sub carries revision and presence notices to Hono SSE. Streams catch up from Neon if a notice is missed.

Passed strict TypeScript, 45 Vitest cases, 30 Playwright cases, the merged production build, and the runtime dependency audit. PostgreSQL tests exercised atomic writes, ownership, conflict detection, rollback, and idempotent retries. The local Hono suite exercised reconnect and rate limits. Playwright exercised same-browser multi-tab editing, anchor presence, conflict resolution, and recovery across reload with intercepted API responses. The M4.2 production test confirmed Neon autosave and live anchor presence in two signed-in tabs.

## M4.2 · MCP foundry

Merged `codex/mcp-foundry` into `main` at `f45760c`. Vercel reports [production](https://glyph-chan.vercel.app/studio/demo) and the [feature preview](https://glyph-chan-en5u1eyl9-chanchans-projects-aada625f.vercel.app/studio/demo) ready. Deployment IDs are `dpl_9PfDyZZYuRgGvGn3ewi4xTJDkyXr` and `dpl_FrstKTohN3kRqqHj4LMkUAtmwNsZ`.

The studio creates a revocable, seven-day bearer token for one agent per collection. MCP v2 exposes three resource types and all nine tools over Streamable HTTP and the local stdio bridge. Agent mutations use the same command reducer and Neon revision checks as the editor, retain attribution, and publish live glyph and optional anchor presence. No database migration or additional Vercel variables were needed for MCP.

Passed strict TypeScript, 48 Vitest cases, 31 Playwright cases, the merged production build, and the production dependency audit. The end-to-end test used real HTTP and stdio clients, a PostgreSQL test database, and an SSE browser connection. It generated two lowercase glyphs from uppercase coordinates and verified the live outline, anchor highlight, and attribution. The signed-in production smoke test verified Clerk, Neon autosave, Redis presence across tabs, MCP discovery and attributed edits, and revoked-token rejection. The temporary test collection and Clerk account were removed.

## M3.2 follow-up · Inngest worker verification

Merged `codex/inngest-worker-verification` into `main` at `6d9de6a`. The [production site](https://glyph-chan.vercel.app) and [worker preview](https://glyph-chan-kdayv04fe-chanchans-projects-aada625f.vercel.app) are ready. A production API smoke test downloaded a one-glyph font and verified the `wOF2` header.

Inngest's test engine now exercises the actual thumbnail and export functions with test persistence. It checks that the thumbnail worker saves an SVG and the export worker publishes a downloadable WOFF2. The export failure handler marks a job failed after retries are exhausted. Its regression test checks idempotence and confirms a completed download is preserved. Strict TypeScript, 49 Vitest cases, 31 Playwright cases, the merged build, and the production dependency audit passed. Playwright verified five Inngest registrations, including the generated failure handler.

Vercel Production is still missing both user-managed Inngest variables, and the Inngest production environment has no Glyph app registered. Hosted thumbnail and WOFF2 execution remains pending.

## Milestone status

| Subgoal | Deliverable | Status |
| --- | --- | --- |
| 1.1 | Foundation, auth, Hono RPC, rate limiting and database | Deployed and verified |
| 1.2 | Dashboard CRUD, landing integration, Inngest specimen thumbnails | Deployed. Hosted Inngest smoke test awaits keys. |
| 2.1 | Deterministic state, attributed commands, undo/redo, path math | Deployed and verified |
| 2.2 | Studio grid, editor, draggable anchors and optical guides | Deployed and verified |
| 3.1 | Kerning, waterfall and optical consistency analysis | Deployed and verified |
| 3.2 | Binary fonts, SVG and React export jobs | Deployed. Hosted Inngest smoke test awaits keys. |
| 4.1 | Redis live presence, SSE and Neon autosave | Deployed and verified |
| 4.2 | HTTP and stdio MCP resources, tools and setup | Deployed and verified |
