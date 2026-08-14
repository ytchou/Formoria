# Formoria staging database and release pipeline

Status: accepted for DEV-1455 (2026-08-14)

## Decision

Staging is a private, writable QA environment backed by the isolated Supabase
project `xwkigpvnheecihpxyvsl`. It is not a read-only production mirror and it
never receives copied production users, private records, storage objects,
secrets, or credentials. The guarded migration tooling remains the source of
truth; local Docker/Supabase replay has been retired.

The canonical E2E origin is `https://staging.formoria.com`. Every seed or E2E
run must prove the tuple `FORMORIA_DEPLOYMENT_ENV=staging`, the staging app
hostname, staging Supabase URL, and `SUPABASE_PROJECT_REF` before mutation.

## Database and Auth

- `pnpm db:migrate:check`, `pnpm db:migrate`, `pnpm db:seed:staging`, and
  `pnpm db:verify` use explicit URLs and the project identity guard.
- `db:seed:staging` is idempotent: it applies the deterministic public fixture
  and creates/refreshes only the environment-defined confirmed `E2E_USER` and
  `E2E_ADMIN` accounts.
- Staging cron is finalized inactive. Production refuses a fresh ledger and
  cannot run the staging seed.
- `staging_auth_email_captures` is RLS protected. An invoker-rights Postgres
  Send Email Hook inserts only the action, namespaced recipient, token hash,
  redirect target, and timestamp. The hook is configured only in staging and
  performs no external delivery.

## Deployment safety

The staging application emits `X-Formoria-Revision` from
`RAILWAY_GIT_COMMIT_SHA`. Nightly, manual, and release-gate workflows resolve
the tested staging SHA, checkout that exact SHA for test code, wait for the
same deployed header, and fail closed on missing/mismatched evidence or
production credentials.

Ordinary pull requests into `staging` run Quality and Build only. The full
staging suite is a nightly/manual/release-PR gate. The first rollout retains
old required check contexts only until the new workflow lands; GitHub rulesets
are then atomically changed to:

- `staging`: `Quality`, `Build`;
- `main`: `Quality`, `Build`, `Release source`, `Staging E2E`.

This repository change does not mutate GitHub external rulesets.

## Rollback

Disable the staging Auth hook, restore the previous staging workflow and
deployed revision, then remove the capture migration only after captures are
audited and deleted. Never roll back by pointing a staging job at production.
