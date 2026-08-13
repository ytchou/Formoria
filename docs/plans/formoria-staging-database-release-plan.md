# Formoria Staging Database and Release Pipeline

## Goal

Create an isolated Supabase staging environment and a guarded, migration-file-driven release workflow. The principal silent-failure risk is credential cross-wiring, so every remote operation must validate the declared environment, explicit database URL, and project reference without relying on `supabase link`.

Current state (2026-08-13): the original 257-migration baseline and district rehearsal are complete. After synchronizing with the latest `origin/staging`, migration `20260813055010_cron_http_dispatch_durable_identity.sql` was also applied through the guard. Staging now has 259 repository migrations, with `20260812033345_brand_channels_district.sql` remaining the staging-only release delta.

## Constraints

- Base this work on `origin/staging` in a linked worktree.
- Pin Supabase CLI `2.110.0` and align local Supabase PostgreSQL with production PostgreSQL 17.
- Keep existing migrations immutable; migrations, not database diffs, are the deployment source of truth.
- Staging may bootstrap inert loopback `app_secrets` and must finish with all cron jobs inactive. Production must reject a fresh database, never install inert secrets, and never disable cron.
- Never clone production Auth users, private data, secrets, storage objects, or analytics/email/worker credentials.
- CI validates migrations but never applies pull-request migrations to a shared remote database.

## Wave 1: Guarded database workflow

- Add `pnpm db:migrate:check`, `pnpm db:migrate`, `pnpm db:seed:staging`, and `pnpm db:verify`.
- Require `SUPABASE_DB_URL`, `SUPABASE_PROJECT_REF`, and `FORMORIA_DEPLOYMENT_ENV`.
- Reject a database URL whose embedded project reference differs from `SUPABASE_PROJECT_REF`.
- Use explicit `--db-url`; never use checkout link state.
- `db:migrate:check` lists migration state and performs a dry-run.
- `db:migrate` validates identity/environment, dry-runs, applies, and verifies. Production refuses a fresh migration ledger. Staging applies the bootstrap before a fresh replay and disables/verifies cron after migration.
- Add tests for missing/mismatched identity and environment-specific safety.

## Wave 2: Replay, verification, and fixture

- Add a staging-only bootstrap prelude that creates `app_secrets` with inert loopback values before historical migrations.
- Add a clean-replay CI check using the project-scoped local PostgreSQL 17 stack; own and clean up every process/resource with a trap.
- Add a verification command covering migration history, schema drift, RLS, buckets, extensions, cron state, and generated database types. Treat diffs as drift evidence only.
- Commit an idempotent staging fixture of about 40 approved public brands and purchase channels, with fixed staging-only UUIDs and explicit columns. Cover product categories, several cities/districts, Unicode, nulls, unmatched addresses, and >=90% district matching.
- Prohibit Auth users, profiles, owners, submissions, email/audit/visitor/secret data, and storage objects. Add only labeled synthetic mutation records.
- Seed against the production migration baseline so the district migration/backfill is rehearsed over existing records.

## Wave 3: Private writable staging and deployment safety

- Replace blanket staging mutation blocking with narrowly authenticated private-QA writes.
- Continue blocking signup, forgot-password, and reset-password email flows.
- Keep email delivery, analytics, indexing, sitemap publication, cron, and curation worker disabled.
- Retain `X-Robots-Tag: noindex, nofollow` and private/no-store caching.
- Add repository-owned Railway pre-deploy/CI contracts so a nonzero guarded migration result prevents app deployment.
- Scope CI behavior so PRs validate locally and never apply migrations to shared remote databases.
- Check test drift for changed app/routes and add a manually dispatched deployed E2E gate for where-to-buy, sign-in, one user mutation, and one admin mutation.

## External rollout (credentialed operations)

1. Create `Formoria Staging` in Supabase organization `ycfoiezbgijmqstekamm`, region `ap-northeast-1`, Micro compute.
2. From `origin/main`, apply exactly the 257 production migrations to establish the baseline.
3. Configure Auth only for `https://staging.formoria.com`; disable public signup, reset email, production OAuth/SMTP, and create two synthetic pre-confirmed QA accounts.
4. Keep cron inactive and omit Resend, OpenAI, Serper, analytics, webhooks, and workers.
5. Replace Railway staging credentials with staging URL, publishable key, secret key, database URL, and project ref; verify all three Supabase credentials differ from production before writes.
6. Seed, then from `origin/staging` verify the only pending migration is `20260812033345_brand_channels_district.sql`, apply it through the guard, dry-run/apply the district backfill at >=90% match, and record unmatched rows.
7. Verify 258 ledger entries, empty repo-to-staging drift, advisors, storage/RLS/functions/grants/extensions manifests, then enable private writable QA.
8. Configure environment-scoped GitHub secrets and remove repository-level Supabase credentials only after staging and production scopes pass.
9. After QA, prepare but do not merge the required `staging -> main` merge-commit PR. Production predeploy must show only `20260812033345`, apply before app rollout, then dry-run/apply the backfill and smoke/verify. Do not pause or delete Agent Hub.

## Verification

- Guard rejects missing declarations and mismatched URL/project refs.
- Clean PostgreSQL 17 replay succeeds through the latest migration.
- Staging finalization leaves every cron job inactive.
- Fixture is idempotent and contains no prohibited private tables/columns.
- Intended authenticated staging writes work while email-dependent Auth flows remain blocked.
- Noindex, no-store, disabled-email, and disabled-analytics behavior remains intact.
- Service integration tests use isolated staging/test Supabase without mocking it.
- Deployed E2E covers where-to-buy, sign-in, one user mutation, and one admin mutation through the private Cloudflare and origin boundaries.
- Repository-to-production schema diff is empty after promotion.

## Pre-mortem

- Fatal assumption: the explicit connection URL reliably identifies the same project as the declared reference. Guard both parsed hostname/reference and a post-connect identity query where available.
- Silent failures: a staging URL pointing at production, cron remaining active, fixture touching private tables, or auth/email behavior changing without deployment failure. Make each a failing verification gate.
