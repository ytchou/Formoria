# GitHub Health Agent Migration — Execution Plan

Date: 2026-07-22
Status: Approved for implementation; production cutover remains gated

## Goal

Replace the Claude Routine and `health-selfheal` workflow with a disabled-by-default,
repair-focused GitHub Actions system covering link health, Directory Health, Sentry
triage, remediation, delivery, and post-deployment confirmation. Growth Pulse is not
part of this system.

## Hard boundaries

- Health automation never edits brand content, links, images, or other application data.
- Database, schema, index, content, and link cleanup findings always require a human.
- Automatic and human-gated findings never share a pull request.
- A finding is fixed only after the authoritative merge SHA is deployed successfully to
  Railway production and `GET /api/health` succeeds.
- Claude never receives production credentials, GitHub App tokens, or unsanitized
  external evidence.
- All workflows remain disabled until Personal OS compatibility is deployed and the
  credential/configuration preflight and GitHub App canary pass.

## Execution waves

### Wave 1 — Personal OS compatibility

Repository: `personal-os`, branch `feat/github-health-agent-compat`

- Suppress the Agent Hub Slack notifier when
  `metadata.notification_owner === "github_actions"` while retaining the run.
- Replace live link `auto_nulled` reporting with `cleanup_required`.
- Add confirmation facts for PR, merge SHA, deployment, smoke, and fixed state; never
  interpret `auto_merge_enabled` as merged.
- Add a forward metadata migration that archives Growth Pulse and points the four retained
  Formoria agents at the GitHub Actions schedule and workflows.
- Supersede contradictory Agent Hub/Slack documentation.

Verification:

- Run scoped Edge Function tests for ingestion/notification behavior.
- Run scoped `run-reports` and Formoria health component tests.
- Run lint and type-check through one `code-verifier` gate.

### Wave 2 — Formoria safety and persistence foundations

- Extend `health_fix_queue` with stable fingerprints, source, evidence, merge policy,
  leases, attempts, retry timing, PR/deployment/confirmation fields, explicit states,
  active-fingerprint uniqueness, and atomic enqueue/claim/transition functions.
- Add least-privilege health reader/writer roles; writer access is function-only and has no
  write access to `brands`.
- Add a same-day run ledger and link distinct-day failure evidence.
- Make link health accept authenticated `dry_run` and a stable run identity.
- Remove every brand write from link health, preserve historical `auto_nulled_at`, emit
  `cleanupRequired`, and make 403/429 non-failures.
- Query only approved brands and make retries idempotent.

Verification:

- Regression tests prove dry-run performs no writes, same-day retries do not increment,
  403/429 do not escalate, and no brand update path remains.
- Migration contract tests cover queue states, legal transitions, lease recovery, active
  fingerprint dedupe, and scoped grants.
- Run one `code-verifier` gate for the wave.

### Wave 3 — Deterministic collectors, policies, and adapters

- Add provider-neutral health contracts and deterministic Directory policies for approved
  brand invariants, distinct-day link/image evidence, DB thresholds, Dependabot severity,
  and safe merged-branch candidates.
- Add a production-only Sentry REST collector capped at 20 issues with incident mode and
  strict sanitization before Claude analysis.
- Add schema validation for classification fields and merge-policy decisions.
- Add audited adapters for Slack, Linear, Sentry resolution, GitHub, and Agent Hub with
  redacted request/response/latency/status logs.
- Add stable Linear fingerprints, lookup-before-create, Formoria team/project routing, and
  no milestone.
- Add duplicate clustering and per-finding traceability.

Verification:

- Unit tests cover threshold recurrence, branch safety, sanitization, malicious prompt
  content, incident mode, schema rejection/retry, sensitive-path gating, Linear dedupe,
  Slack chunking, and independent delivery failures.
- Run one `code-verifier` gate for the wave.

### Wave 4 — Orchestration, repair, confirmation, and watchdog

- Replace `health-selfheal.yml` with a 07:00 Taipei orchestrator (`0 23 * * *`) supporting
  `preflight`, `live`, and controlled canary/fix dispatch modes.
- Start link and Sentry collection in parallel, run Directory after link telemetry, and
  aggregate under `if: always()` with synthesized failure envelopes.
- Deliver the three collector envelopes exactly once and send one complete direct Slack
  digest; mark Agent Hub data with `notification_owner: github_actions`.
- Claim all eligible findings present at batch creation, build one automatic PR, confirm it,
  then build one separate human-review PR. Cap fix/review at two cycles.
- Add event-driven PR/Railway confirmation and the 08:30 Taipei freshness watchdog.
- Archive the Routine prompt and leave a retirement tombstone.

Verification:

- Workflow contract tests cover triggers, disabled gates, outputs, `if: always()`, secret
  isolation, batching, two-cycle escalation, merge semantics, SHA matching, smoke gating,
  Sentry resolution timing, and watchdog failure delivery.
- Run one `code-verifier` gate for the wave.

### Wave 5 — Stable PR CI and control-plane policy

- Expose stable Quality, Integration, and Change Policy checks on every pull request.
- Use disposable local Supabase, `supabase migration up --local`, local seeded accounts,
  production-equivalent build, and selective Playwright without production secrets.
- Remove Dependabot build skipping and every swallowed E2E failure.
- Add CODEOWNERS and diff policy for workflows, prompts, permissions, auth, migrations,
  merge policy, and validation weakening.
- Share one writer concurrency group between health repair and E2E self-heal.

Verification:

- Workflow contracts prove all stable checks are always created.
- Local integration runs apply migrations without `supabase db reset`.
- Dependabot-equivalent build and real failing Playwright exit behavior are tested.
- Run one `code-verifier` gate for the wave and perform the E2E drift grep.

### Wave 6 — External rollout (operator gate)

- Deploy Personal OS migration and Edge Function compatibility first.
- Upgrade GitHub plan, install the repository-scoped App, configure scoped credentials and
  variables, create labels, enable auto-merge, and establish branch rules after checks have
  successful names.
- Run credential preflight without printing values.
- Run one mutation-free preflight and one harmless App-authored canary through CI, merge,
  Railway deployment, and production smoke.
- Only then enable `HEALTH_AGENT_ENABLED` and `HEALTH_AUTOFIX_ENABLED`, retire the Claude
  Routine, and unschedule `link-health-daily` after an integrated link run succeeds.

Verification:

- Confirm the next 07:00 run produces Link, Directory, and Sentry Agent Hub rows plus one
  Slack digest.
- Deliberately exercise the 08:30 watchdog against a missing/stale test run.
- Record first-five-run local Supabase runner overhead.

## Dependency sweep

- `runLinkHealthCheck` has one production caller: the authenticated cron route.
- `health_fix_queue` is currently used only by the Routine prompt and
  `health-selfheal.yml`; both are replaced in this migration.
- `health_snapshots` is currently Routine-only.
- `link_check_results` is written by link health and read by Directory Health.
- Agent Hub delivery reuses `scripts/agent-hub/report-run.mjs` rather than adding another
  envelope implementation.
- `GET /api/health` is the existing production smoke contract.
- UI/route drift checks include the link cron route and health endpoint tests; no visible
  application text is intentionally changed.

## Pre-mortem

The single assumption that can invalidate cutover is that GitHub App-authored pull requests
trigger every protected check, auto-merge, Railway deployment event, and deployment SHA
continuity. The controlled canary is therefore mandatory and no variable is enabled before
it succeeds.

The highest-risk silent failures are: a same-day retry changing brand data; a path-filtered
required check never appearing; auto-merge enablement being recorded as a merge; an Agent
Hub insert duplicating Slack; and a deployment event for the wrong SHA marking findings
fixed. Contract tests and explicit state transitions cover each case.

## Rollback

Disable both health variables and GitHub App writes. If necessary, restore the archived
Routine prompt and reschedule the legacy link cron. No brand-data rollback is required
because the migrated system never changes brand fields.
