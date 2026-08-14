# DEV-1455 — Staging-only E2E and release gate

## Objective

Make `https://staging.formoria.com` and its isolated Supabase project the
canonical end-to-end target. Ordinary pull requests into `staging` do not run
E2E; the complete deep/mobile suite runs against the deployed staging revision
nightly, manually, and on every `staging -> main` release pull request.

## Waves

### Wave 1 — remove local replay and establish the contracts

- Preserve the guarded database deploy/migration checks, but remove the Docker
  and local-Supabase replay workflow and scripts.
- Add this plan, the accepted architecture/ADR, runbooks, and environment
  contracts.
- Add pure staging-target guards for seed and E2E callers.

### Wave 2 — staging database and Auth capture

- Extend the idempotent staging seed with deterministic public fixtures and the
  two confirmed E2E accounts from environment credentials.
- Add the RLS-protected staging Auth email capture table and invoker-rights Send
  Email Hook migration. Capture only the action, namespaced recipient, token
  hash, redirect target, and timestamp.
- Add capture lookup/delete helpers and fail-closed cleanup/audit behavior.

### Wave 3 — deployed staging verification and release policy

- Add `X-Formoria-Revision` from `RAILWAY_GIT_COMMIT_SHA` on staging responses.
- Convert nightly/manual and release workflows to checkout the exact staging
  SHA, wait for the matching deployed revision, reject production/cross-wired
  credentials, and run the complete deep/mobile suite without a local build.
- Remove production synthetic and ordinary-PR E2E workflows; keep one serialized
  deployed-staging invocation while Playwright retains safe intra-suite worker
  parallelism.

### Wave 4 — self-heal and release documentation

- Freeze deployed-app and repair-test SHAs in self-heal context.
- Permit exact/full verification and self-merge only for test-only `e2e/**/*.ts`
  repairs into `staging`; classify `src/**` repairs as `review_ready`.
- Document first-rollout ruleset transition, rollback, cleanup, and required
  checks (`Quality`, `Build`, `Release source`, `Staging E2E`).

## Verification

- Focused Vitest contract tests for target guards, seed/bootstrap SQL, Auth hook
  grants/RLS/capture, workflow triggers/revision checks, self-heal policy, and
  absence of production/local-replay E2E references.
- `pnpm lint`, `pnpm typecheck`, and `pnpm build` where the local environment
  permits.
- Real staging migration/seed twice, durable account authentication, captured
  signup/recovery link journeys, complete deep/mobile run, cleanup audit, and
  DEV-1416 concurrent-submission proof are external follow-ups requiring the
  staging environment and must fail closed when unavailable.
- Verify GitHub rulesets after the workflow lands; this repository change does
  not mutate GitHub external state.

## Rollback

Disable the staging Auth hook before reverting its migration, restore the prior
  staging-only workflow, and use the exact previous staging SHA. Never point an
  E2E workflow or cleanup helper at production as a rollback shortcut.
