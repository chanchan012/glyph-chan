# Glyph foundation

## Request paths

Next.js 16 App Router serves `/` and `/demo` as public specimen surfaces. Four original contours live in `src/lib/specimens.ts`. Selection, fill/outline and guide visibility are transient browser state. The responsive shell occupies `100dvh`. A constrained panel permits internal scrolling for longer Clerk challenges. Typography is self-hosted through Fontsource.

`src/proxy.ts` invokes Clerk on the page routes when both keys exist. The root layout mounts ClerkProvider when configured. The catch-all sign-in and sign-up pages render Clerk's corresponding path-routed widget and default to the dashboard. The unconfigured shell offers a guest link.

The Node route `src/app/api/[[...route]]/route.ts` delegates GET, POST, PATCH, and DELETE to `src/server/api.ts`. Hono independently verifies Clerk sessions and limits requests using Upstash Redis. The limiter allows 60 requests per minute in a sliding window. It buckets members by verified Clerk ID and Vercel guests by the ingress-provided IP, with a shared fallback for other hosts. The public demo can operate without external services. Enabling account access requires both Clerk and Redis credentials. Partial or unavailable Redis configuration returns 503. Quota exhaustion returns 429 with Retry-After. Responses use private, no-store caching.

| GET route | Response |
| --- | --- |
| /api/health | `{service:"glyph",status:"ok"}` after middleware checks |
| /api/session | `{mode:"guest"}` or `{mode:"member",userId:string}` |
| /api/account | `{userId:string}` or 401 `{error:"authentication_required"}` |

## Collections dashboard

`/dashboard` shows a responsive, internally scrollable collection grid. Guests browse sample data and can enter Clerk sign-in. Authenticated members use the typed Hono client and see only their collections. Clerk sign-in and sign-up default to the dashboard.

| Route | Input and output |
| --- | --- |
| GET /api/collections | `{collections: Collection[]}` |
| POST /api/collections | `{name,kind}` → 201 `{collection}` |
| PATCH /api/collections/:id | UUID and `{name}` → 200 `{collection}` |
| DELETE /api/collections/:id | UUID → 204. Cascades to its glyphs and kerning pairs. |

A `Collection` contains `id`, `name`, `kind` (`typeface` or `icon_set`), `updatedAt` (ISO string), and `thumbnail` (SVG string or null). The API checks the verified Clerk subject on every query. Mutations require a same-origin request. Cross-owner mutations return 404.

Inngest serves `glyph-foundry` at `/api/inngest`. The `glyph/thumbnail.requested` event contains the collection UUID and verified owner ID. The worker renders an escaped SVG specimen and conditionally updates the row where the owner, name, and kind match. Updates clear the thumbnail before queuing a fresh job. An hourly repair function finds pending thumbnails in bounded batches. The browser uses a deterministic SVG fallback until the saved preview is available.

`AppType` is exported for Hono RPC consumers. `createApi` accepts identity and rate-limit adapters for isolated tests. The requested `@hono/clerk-auth` adapter is deprecated upstream in favor of `@clerk/hono`.

## Persistence

The GitHub-linked Vercel project is `glyph-chan` in `chanchans-projects-aada625f`. Main deploys to production and feature branches deploy as previews. The project uses Next.js framework detection and Node 24. Deployments serve guest specimens without a database connection.

`src/db/schema.ts` defines the schema. `src/db/client.ts` opens a Neon HTTP connection on demand. Migrations live in `drizzle/`. The shell does not write to a database.

The deployed database is `glyph` on the production branch of Neon project `still-bird-86777802`. The initial migration is recorded in `drizzle.__drizzle_migrations`. Vercel Production connects through the pooled endpoint as `glyph_runtime`, which has SELECT, INSERT, UPDATE, and DELETE on the three Glyph tables. The migration owner manages schema changes and grants access to new tables explicitly.

| Relation | Columns and constraints |
| --- | --- |
| collections | UUID primary key, indexed Clerk owner_id, required name and kind (typeface or icon_set), positive units_per_em default 1000, ascender 800, descender −200, cap_height 700, x_height 500, created_at and updated_at default to now, nullable thumbnail text, studio_revision integer default 0, studio_receipts JSONB default []. |
| glyphs | UUID primary key; collection_id FK with cascade; unique (collection_id, key); paths JSONB array of SVG path strings default []; advance_width 600; left_bearing and right_bearing 50; revision 0. |
| kerning_pairs | collection_id FK with cascade; unique (collection_id, left_key, right_key); required signed integer adjustment in font units. |

## Vector document and command history

`GlyphFoundryState` contains a collection ID and kind, a document revision, optical metrics, and a map of glyphs by key. Typeface keys are Unicode scalar values. Icon-set keys are strings. A glyph contains its editable contours and advance width and sidebearings in font units. The studio coordinate model uses SVG's y-down direction and baseline y=0. Font metrics retain positive ascenders and negative descenders. The public specimen plates retain their own viewport and use the shared SVG parser for anchor positions.

The canonical contour starts with an anchor and holds absolute line, quadratic, or cubic segments. A separate flag closes the contour. The SVG parser expands relative and smooth commands and converts arcs to cubic approximations. Coordinates are normalized to eight decimal places. Paper.js handles nonzero-fill union, subtraction, and intersection, preserving holes, disconnected components, and cubic geometry. Bézier helpers evaluate and split curves and calculate bounds from extrema.

Every command accepts a caller-provided ID, actor kind and ID, UTC timestamp, and optional expected revision. `recordCommand` applies one atomic Immer edit and returns forward and inverse patches. Zustand stores a bounded history with attribution and clears redo when a new edit succeeds. Dispatch, undo, and redo advance the document revision. Replay of the same commands against the same base document is deterministic.

## Studio

`/studio/[id]` exposes the glyph matrix, SVG editor, and glyph and optical metrics inspector. The desktop has three panes. Compact layouts switch panes within the same 100dvh shell and keep the document and open pen path in memory. Guest sample IDs are `demo`, `forma`, `axial`, and `orbit`. A verified member opens a private collection through GET `/api/collections/:id/studio`. The query scopes the collection and its glyph join to the verified owner.

The Studio response includes the collection ID, name, owner, kind, optical metrics, each glyph's key, serialized paths and metrics, saved kerning, shared revision, and recent receipts. The browser converts this model to `GlyphFoundryState`. Undo and redo are session-local. Integrating a changed shared document clears the undo stack so history applies to the current outlines.

Pointer gestures convert through the inverse SVG screen transform and use pointer capture. A drag previews in component state and commits one action with the starting document revision. The Node tool carries attached handles when moving an anchor. Pen drag adds a tangent to the current node. Pen supports line, quadratic, and cubic modes, and can finish open or close. Rectangle and ellipse tools produce closed contours. The inspector applies boolean operations to selected closed contours, where the first selected is the subtraction subject. Paper.js runs through its browser entry on the client and is externalized from the Next.js server bundle.

### Shared autosave and presence

| Route | Contract |
| --- | --- |
| GET /api/collections/:id/studio | `{studio}` includes `syncRevision` and recent `receipts`. |
| PATCH /api/collections/:id/studio | `{requestId,expectedRevision,snapshot:{metrics,glyphs,kerning}}` → 200 with saved revision and receipt, or 409 with the latest studio. |
| POST /api/collections/:id/presence | `{clientId,glyph,anchor:{contour,index}\|null}` → 204. Glyph may be null. |
| GET /api/collections/:id/events | SSE carrying `revision`, `presence`, `roster`, and `heartbeat`. Each revision event has the revision as its SSE ID. |

Neon commits guides, glyphs, pairs, the next revision, and the attributed receipt in one conditional SQL statement. The collection keeps the most recent 32 receipts as `{requestId,revision,actor:{kind,id,label},at}` to recognize retried saves. The repository scopes each read and write to the verified owner. Clerk and the existing same-origin policy cover browser saves and presence. A reconnect fetches the current revision and then loads the complete studio snapshot when newer.

Redis channels use `glyph:live:v1:<collection>:events` and the corresponding `:presence` hash. A room tracks up to 32 sessions. Presence expires after 45 seconds and visible clients refresh every 18 seconds. The room hash expires after 60 seconds. Streams reconcile against Neon and refresh the roster every 15 seconds, and reconnect after up to 52 seconds to stay within the Vercel function budget.

Member clients compare local and shared edits against the last acknowledged snapshot. Separate glyphs, pairs, and guide fields merge automatically. Overlaps and guide or pair dependencies ask the designer to choose a version. The browser stores unsettled changes at `glyph:studio:v1:<owner>:<collection>:draft:<tab-id>`, keeping the tab ID in session storage for reloads. The backup contains the base revision, base snapshot, pending request, and conflict data. Choosing the shared version stores the local recovery copy. Guests keep the original collection-local draft key. The first connected tab imports a legacy member draft and asks for a choice if the shared collection already contains changes.

## Typeface proofing

The Studio's Specimen view draws the editable contours in a waterfall at 16, 24, 36, 54, and 80 px. Text is normalized to NFC and laid out as Unicode scalar glyphs. Every line uses advance widths, left sidebearing offsets from outline bounds, and optional signed pair adjustments in font units. Missing characters have outlined markers and a fallback advance. Space has a fallback advance when the font has no space glyph. The preview is glyph-based and uses direct pair positioning.

`GlyphFoundryState.kerning` is an ordered set of `{left,right,adjustment}` pairs. `setKerningPair` validates both glyph keys and a signed 16-bit value. Zero removes an entry. Removing a glyph removes its pairs. Undo and redo cover these changes. The editor previews a tentative adjustment in the waterfall before the user commits it. The owner-scoped Studio API reads saved pairs from `kerning_pairs`. The local draft encoder stores current pairs and can restore drafts created before M3.1.

The optical audit measures closed outlines with nonzero fill. It splits curves at extrema into monotone intervals, resolves crossings for eleven scanlines in each axis, and reports the median of each scanline's thinnest filled run. It compares vertical stem widths against the collection median or an explicit target, and reports signed top and bottom deviations from the applicable cap-height, x-height, ascender, baseline, or descender guide.

## Font and icon exports

The studio sends a validated snapshot of its current draft to POST `/api/exports`, including canonical paths, metrics, kern pairs, and a selected output format. The server derives the member collection name from the verified owner record. Origin checks use the public Host header, with HTTPS on Vercel, so the browser origin can differ from Next.js's internal listen URL.

The font compiler builds OpenType glyphs with the studio's advance and visible left sidebearing, converts SVG y-down coordinates to font y-up, and subdivides cubics into quadratics before TrueType quantization. The fonteditor-core SFNT writer emits actual `glyf`, `cmap` and `hmtx` tables with both GPOS and legacy kern pair tables. WOFF2 compresses the resulting TrueType with the WOFF2 reference WASM. Icon outputs include an SVG symbol sheet, a ZIP with typed React components and a sprite, and specimen SVGs. Paths are canonicalized and XML labels are escaped.

Guest exports and member exports where Inngest is unavailable return the artifact directly. When Inngest and Upstash are configured, a member request gets a 202 with a job UUID. The `glyph/export.requested` event carries only that UUID. Upstash stores the private snapshot, status and artifact as separate keys under `glyph:exports:v1:` for 24 hours. The export worker publishes status and artifact atomically, and a repair worker retries queued submissions that predate its execution by two minutes. GET `/api/exports/:id` and GET `/api/exports/:id/download` check the job owner. The API limits request bodies to 1 MB and downloadable artifacts to 3 MB. The current browser tab keeps the last background job ID in session storage.
