# Formoria GitHub Health Agent Design

Date: 2026-07-22

## System boundary

The health agent observes production state, classifies evidence, opens repair pull requests,
and confirms deployment. It never repairs brand content or performs database/schema/index
changes. Provider integrations remain behind audited script adapters; workflows perform
wiring and pass sanitized artifact files between secretful collection and secretless Claude
or validation jobs.

## Daily flow

1. At 07:00 Taipei, link and Sentry collection start in parallel.
2. Link collection calls the authenticated Railway endpoint with a stable run identity; the
   endpoint is idempotent and telemetry-only.
3. Directory collection runs after link telemetry and combines approved-brand invariants,
   distinct-day link/image evidence, database thresholds, Dependabot severity, and safely
   removable branch candidates.
4. Sentry collection keeps unresolved production issues, removes development events,
   sanitizes sensitive fields, caps Claude input at 20, and marks larger sets incident mode.
5. Aggregation runs under `if: always()`, creates failure envelopes for missing outputs,
   attempts Agent Hub and Slack independently, and creates Linear only for human work.
6. Findings are fingerprinted and atomically enqueued. Automatic code findings and
   human-gated code findings form separate all-eligible batches.
7. Claude repairs/reviews only checked-out files with no network or production credentials.
   A later secretless job validates the result. Two failed cycles escalate the entire batch.

## State model

Allowed queue states are `pending`, `claimed`, `pr_opened`, `awaiting_human`, `merged`,
`deployed`, `fixed`, `failed`, `skipped`, and `needs_human`. Active fingerprints are unique.
Claims have owner/expiry, attempts, last error, and next-attempt time. Transitions occur only
through database functions that validate the current state.

`auto_merge_enabled` is confirmation metadata, never a state transition. A merged PR stores
GitHub's authoritative merge SHA. A matching successful Railway production deployment moves
the batch to `deployed`; a successful `GET /api/health` moves it to `fixed` and permits
Sentry resolution. A closed-unmerged PR moves to `needs_human` and never resolves Sentry.

## Merge policy

- `automatic`: noncritical, high-confidence, reproducible application defects with no
  sensitive/control-plane path and no intended behavior change; patch/minor security fixes
  after full validation.
- `human`: critical production issues, ambiguous/behavior-changing fixes, major dependency
  upgrades, sensitive paths, control-plane changes, and all data/content/DB/schema/index/link
  cleanup work.

Duplicate findings are clustered by shared root cause while the queue, PR body, Agent Hub
result, and confirmation retain each fingerprint and its evidence/changed-file mapping.

## Delivery contracts

Agent Hub envelope version remains 1 with existing routine names `link-checker`,
`directory-health`, `sentry-triage`, and `health-selfheal`. Producers use
`source: github_actions`, unique workflow-attempt source IDs, and
`data.notification_owner: github_actions`. Slack receives a safely chunked actionable
digest or compact all-clear. Linear uses hidden stable fingerprints, lookup-before-create,
the Yung-Tang Chou team, Formoria project, `Ops`/`Data Quality`, and no milestone.

## Security

- A repository-scoped GitHub App supplies short-lived tokens for contents, pull requests,
  and issue labels/comments. Claude never receives the token.
- Sentry read and resolve tokens are separate; Linear, Slack, Agent Hub, Railway, and link
  endpoint credentials are scoped independently.
- The health database reader can read only required approved-brand/health/statistics data.
  The writer can execute only health snapshot/queue functions and cannot write `brands`.
- Every external adapter logs redacted request/response payloads, latency, status, and
  schema-validation outcome.

## Operational controls

Both health variables default false. `preflight` disables Linear, queue claims, cleanup,
pull requests, and all business mutations. `live` requires both gates. The 08:30 watchdog
uses an independent delivery path. Repository rules require stable Quality, Integration,
and Change Policy checks plus Code Owner approval for control-plane paths.
