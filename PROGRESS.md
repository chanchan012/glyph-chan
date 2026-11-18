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

The initial deployment is in guest mode. The Neon migration was generated and checked in. Live Clerk sign-in, live Redis quotas, and application of the migration to a selected Neon database remain environment-dependent verification steps.

## Remaining milestones

| Subgoal | Deliverable | Status |
| --- | --- | --- |
| 1.2 | Dashboard CRUD, landing integration, Inngest specimen thumbnails | Pending |
| 2.1 | Deterministic state, attributed commands, undo/redo, path math | Pending |
| 2.2 | Studio grid, editor, draggable anchors and optical guides | Pending |
| 3.1 | Kerning, waterfall and optical consistency analysis | Pending |
| 3.2 | Binary fonts, SVG and React export jobs | Pending |
| 4.1 | Redis live presence, SSE and Neon autosave | Pending |
| 4.2 | HTTP and stdio MCP resources, tools and setup | Pending |
