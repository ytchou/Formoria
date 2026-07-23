# ADR: GitHub Actions Owns Formoria Health and Repair

Date: 2026-07-22
Status: Accepted, rollout gated

## Decision

Move Formoria's daily link, Directory, and Sentry health work from Claude Routines and the
existing `health-selfheal` workflow into one GitHub Actions control plane. Deterministic
collectors and policies run without Claude; Claude is used only for sanitized semantic
classification and isolated filesystem repair/review. Growth Pulse is retired from health.

This decision supersedes the Claude-Routine execution choice in
`2026-06-21-daily-sentry-triage.md`, the Routine delivery portions of
`2026-07-15-agent-hub-direct-reporting-plan.md`, and the existing health self-heal design.
The PostHog analytics hub remains valid for product analytics but is not a health-agent
input.

## Rationale

The current system can silently mutate brand links after repeated invocations, sends raw
production evidence to MCP/Seer, caps repair at three Sentry issues, treats auto-merge as a
merge, and marks findings fixed before deployment confirmation. A single stateful GitHub
control plane can enforce deterministic policy, credential isolation, stable delivery, and
merge-to-production confirmation.

## Consequences

- GitHub Actions owns direct Slack delivery; Agent Hub stores marked envelopes without
  sending a duplicate Slack message.
- Link health is telemetry-only. Content and database repair remain human-owned.
- Automatic and human-gated fixes are batched separately, with all eligible findings in the
  batch and at most two repair/review cycles.
- Queue state is authoritative; merge, deployment, and smoke are distinct states.
- The daily target is 07:00 Asia/Taipei and the 08:30 watchdog independently detects stale
  or pre-delivery runs. GitHub scheduling remains best-effort.
- Production cutover depends on GitHub Pro controls, a repository-scoped GitHub App,
  separate scoped credentials, Personal OS compatibility, a mutation-free preflight, and a
  successful App-authored canary.

## Rejected alternatives

- Keep the Claude Routine and add more prompt rules: rejected because prompt policy cannot
  provide atomic leases, least privilege, idempotency, or deployment confirmation.
- Keep link health as a separate writer: rejected because retries can race and duplicate
  evidence, and the old service writes application data.
- One mixed repair PR: rejected because human-gated findings would either block safe
  automatic work or weaken the gate.
- Mark fixed at merge: rejected because the deployed SHA and production smoke remain
  unknown.

## Cutover gate

The App-authored canary must prove required checks, auto-merge, Railway deployment events,
matching SHA, and production smoke. Failure keeps both health variables disabled.
