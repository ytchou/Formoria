# Formoria — Project Context for the Ops Routine

The routine's clone contains no `CLAUDE.md` and almost no `docs/`, because both are gitignored. This file holds the subset that repair work needs.

## What Formoria is

Formoria is a directory that helps Taiwanese products get discovered. Every purchase routes out to the brand's own channel. Formoria never stores commerce truth: no price, inventory, variants, or checkout data. Do not add any of these in a fix.

## Stack

- Next.js 16 (App Router), React 19, TypeScript (strict)
- Supabase: Postgres, Auth, Storage
- Railway (hosting): the web app plus the `health-agent`, `repo-worker`, `curation-worker`, and `e2e-nightly-agent` services. Their config files are in `railway/*.json`.
- Sentry (errors), GA4/PostHog (analytics), Langfuse (LLM traces and prompts)

## Environments

| | Production | Staging |
|---|---|---|
| Git branch | `main` | `staging` (the development base) |
| Supabase ref | `xkcayngbttpxyibgzern` | `ttkkyvgvcamfoezsetvf` |
| Web host | `formoria.com` | `staging.formoria.com` (behind Cloudflare Access) |

- The staging database is a stale snapshot of approved brands. Do not use staging data to explain production behavior.
- Railway does **not** apply migrations to production. A migration that exists in `supabase/migrations/` may be missing in production.
- pg_cron jobs call the app over HTTP. The URL comes from `public.app_secrets` (`cron_base_url`). Auth is the `x-origin-verify` header, which must match `ORIGIN_SECRET`.

## Release flow

- All PRs target `staging`. Never open a PR against `main`.
- Only a deliberate `staging -> main` promotion reaches production. A merged fix is therefore not live until it is promoted. Say this in the PR body when the finding is a production finding.

## Layer ownership

| Layer | Allowed | Not allowed |
|---|---|---|
| `src/app/api/` routes | Auth checks, a call to the service layer, the response | Direct Supabase queries, business logic |
| `src/lib/services/` | All business logic and Supabase queries | UI concerns |
| `src/lib/adapters/` | External SDK and API adapters | Business logic |
| `src/components/` | Rendering and event handlers | Direct Supabase calls, business logic |

- Database columns are snake_case. TypeScript is camelCase. Transform at the service boundary.
- External API calls go through `auditedCall` (`@/lib/audit`).
- Brand data mutations go through the approval queue. Never write to `brands` directly.

## Tests and gates

- Unit tests use Vitest: `pnpm exec vitest run <files>`. Do not run the whole suite. `pnpm test -- <file>` also runs everything.
- **Never mock Supabase or services.** `scripts/check-test-boundaries.mjs` fails on `vi.mock('@/lib/supabase/…')`, `@/lib/services/…`, or `@supabase/…`. Test pure functions at the service boundary.
- A CJK guard test scans source and comments. Do not add Chinese text to code comments.
- The repository has no database-backed tests. RLS, constraints, and RPCs are verified only on staging.

## Code conventions

- Match the surrounding code: naming, comment density, idioms.
- Grep for an existing helper before you write one.
- A local problem gets a local fix. Do no refactors or cleanups outside the finding's scope.
- If you add an intentional shortcut, write a comment that states its limit and its upgrade path.

## Known traps

- The Supabase client is untyped, so `tsc` passes on column names that do not exist. Check the column in `supabase/migrations/` or with a query.
- PostgREST returns at most 1000 rows per request, even with a larger `.limit()`. Paginate counts, or use `count=exact`.
- `approve_submission` and `apply_brand_refresh*` have no SQL source file in the repo. Do not "fix" them from code alone.
