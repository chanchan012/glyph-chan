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

`AppType` is exported for Hono RPC consumers. `createApi` accepts identity and rate-limit adapters for isolated tests. The requested `@hono/clerk-auth` adapter is deprecated upstream in favor of `@clerk/hono`.

## Persistence

`src/db/schema.ts` defines the schema. `src/db/client.ts` opens a Neon HTTP connection on demand. Migrations live in `drizzle/`. The shell does not write to a database.

| Relation | Columns and constraints |
| --- | --- |
| collections | UUID primary key; indexed Clerk owner_id; required name and kind (typeface or icon_set); positive units_per_em default 1000; ascender 800, descender −200, cap_height 700, x_height 500; created_at and updated_at default to now. |
| glyphs | UUID primary key; collection_id FK with cascade; unique (collection_id, key); paths JSONB array of SVG path strings default []; advance_width 600; left_bearing and right_bearing 50; revision 0. |
| kerning_pairs | collection_id FK with cascade; unique (collection_id, left_key, right_key); required signed integer adjustment in font units. |

Collection handlers in 1.2 must scope every query to the verified owner and set updated_at on writes. The static specimen studies use SVG coordinates with the y-axis down. Font metrics use positive ascenders and negative descenders. The future path engine owns conversion between those spaces.
