# Formoria GitHub Health Agent Design

Date: 2026-07-22

## System boundary

The health agent observes production state, classifies evidence, opens repair pull requests,
and confirms deployment. It never repairs brand content or performs database/schema/index
changes. Provider integrations remain behind audited script adapters; workflows perform
wiring and pass sanitized artifact files between secretful collection and secretless Claude
or validation jobs.

## Daily flow

1. At 07:13 Taipei, product, runtime, and repository health start independently after one setup.
2. Link collection calls the authenticated Railway endpoint with a stable run identity; the
   endpoint is idempotent and telemetry-only.
3. Directory collection runs after link telemetry and combines approved-brand invariants,
   distinct-day link/image evidence, database thresholds, Dependabot severity, and safely
   removable branch candidates.
4. Sentry collection keeps unresolved production issues, removes development events,
   sanitizes sensitive fields, caps Claude input at 20, and marks larger sets incident mode.
5. Aggregation runs under `if: always()`, rejects missing or malformed outputs, deduplicates
   findings, updates the rolling Linear issue, and sends an initial Slack report only when findings exist.
6. Findings are fingerprinted and atomically enqueued. Safely scoped code findings form one
   manager-reviewed repair batch; escalation-only findings never receive repository access.
7. Claude repairs/reviews only checked-out files with no network or production credentials.
   A later secretless job validates the result. Two failed cycles escalate the entire batch.

## State model

Allowed queue states are `pending`, `claimed`, `pr_opened`, `awaiting_human`, `merged`,
`deployed`, `fixed`, `failed`, `skipped`, and `needs_human`. Active fingerprints are unique.
Claims have owner/expiry, attempts, last error, and next-attempt time. Transitions occur only
through database functions that validate the current state.

`auto_merge_enabled` is always false. A manager-merged PR stores
GitHub's authoritative merge SHA. A matching successful Railway production deployment moves
the batch to `deployed` after a successful `GET /api/health`. A later complete detector result
moves an absent finding to `fixed`; only then is the exact Sentry provider issue resolved. A newer
Sentry event marks the finding regressed. A closed-unmerged PR moves to `needs_human`.

## Execution phases

The scheduled/manual workflow has one job and one working directory with five named stages: Setup,
Run health groups, Consolidate and report, Self-heal and publish, and Final manager report. It uploads
one artifact containing `health-run.json` and `audit.jsonl`; detector output remains temporary.

Human-policy findings without repository-relative changed files bypass code repair, transition to
`needs_human`, and notify Linear/Agent Hub/Slack without failing the workflow. Claude Sentry
classification retries once when the action itself fails or returns an invalid structured result.

## Merge policy

Every generated repair PR is human-reviewed. Findings without trustworthy tracked file scopes,
and all data/content/DB/schema/index/link cleanup work, remain escalation-only.

Duplicate findings are clustered by shared root cause while the queue, PR body, Agent Hub
result, and confirmation retain each fingerprint and its evidence/changed-file mapping.

## Delivery contracts

Agent Hub receives one version-1 run envelope. Producers use
`source: github_actions`, unique workflow-attempt source IDs, and
`data.notification_owner: github_actions`. Slack receives a safely chunked actionable
findings summary followed by a standalone final report, or one compact all-clear. Linear uses hidden stable fingerprints, lookup-before-create,
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
pull requests, and all business mutations. `live` requires both gates. Operators enable
GitHub Actions failure notifications for workflow failures; GitHub's schedule remains
best-effort and does not notify when no run is created. Repository rules require stable
Quality, Integration, and Change Policy checks plus Code Owner approval for control-plane
paths.
