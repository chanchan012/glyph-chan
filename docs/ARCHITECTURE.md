# Glyph foundation

## Request paths

Next.js 16 App Router serves `/` and `/demo` as public specimen surfaces. Four original contours live in `src/lib/specimens.ts`. Selection, fill/outline and guide visibility are transient browser state. The responsive shell occupies `100dvh`. A constrained panel permits internal scrolling for longer Clerk challenges. Typography is self-hosted through Fontsource.

`src/proxy.ts` invokes Clerk on the page routes when both keys exist. The catch-all sign-in and sign-up pages mount ClerkProvider and Clerk's corresponding path-routed widget. The unconfigured shell offers a guest link. Account redirects currently land at the specimen demo.

The Node route `src/app/api/[[...route]]/route.ts` delegates GETs to `src/server/api.ts`. Hono independently verifies Clerk sessions and limits requests using Upstash Redis. The limiter allows 60 requests per minute in a sliding window. It buckets members by verified Clerk ID and Vercel guests by the ingress-provided IP, with a shared fallback for other hosts. The public demo can operate without external services. Enabling account access requires both Clerk and Redis credentials. Partial or unavailable Redis configuration returns 503. Quota exhaustion returns 429 with Retry-After. Responses use private, no-store caching.

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
| collections | UUID primary key, indexed Clerk owner_id, required name and kind (typeface or icon_set), positive units_per_em default 1000, ascender 800, descender −200, cap_height 700, x_height 500, created_at and updated_at default to now, nullable thumbnail text. |
| glyphs | UUID primary key; collection_id FK with cascade; unique (collection_id, key); paths JSONB array of SVG path strings default []; advance_width 600; left_bearing and right_bearing 50; revision 0. |
| kerning_pairs | collection_id FK with cascade; unique (collection_id, left_key, right_key); required signed integer adjustment in font units. |

The static specimen studies use SVG coordinates with the y-axis down. Font metrics use positive ascenders and negative descenders. The path engine owns conversion between those spaces.
