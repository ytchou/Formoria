# Agent Hub Direct Reporting — Formoria Plan

Date: 2026-07-15

## Goal

Replace routine-output git commits and direct service-role RPC calls with the scoped Agent Hub ingestion endpoint owned by Personal OS.

## Changes

- Add a dependency-free, tested Node reporter with schema validation, idempotency, retry policy, and structured audit logs.
- Update all four routine prompts to write a temporary envelope and call the reporter without committing repository files.
- Route nightly E2E through the same endpoint, schedule it at 06:10 Taipei, and retain failure artifacts for seven days.
- Delete obsolete Agent Hub/Slack relay files after the new endpoint is available.
- Reconfigure the saved Claude Routines to bootstrap from repository prompt files and create the missing Mention Tracker.

## Verification

- Reporter unit tests cover validation, retry/no-retry behavior, idempotency fields, and secret redaction.
- Prompt contract tests reject git-based delivery instructions.
- A manual E2E dispatch and four Routine runs each insert one Agent Hub record.
- Replaying a payload does not create a duplicate.
- Formoria lint, typecheck, affected tests, and workflow syntax checks pass.

This plan supersedes `docs/plans/2026-07-14-routine-logs-relay-plan.md`.
