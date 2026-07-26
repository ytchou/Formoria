# Health Agent Production-Cycle Repair Plan

## Production evidence

- Run `30190904861` repeated every reusable-workflow job under every phase, so irrelevant skipped jobs appeared in each group.
- Both Sentry classification attempts exited with `is_error: true`, zero model cost, and no `structured_output`; the pinned Claude action reported the missing structured output only after the provider invocation.
- Phase 3 delivered successfully, but Phase 4 and Phase 5 were skipped after the Phase 2 failure.
- Queue orchestration discarded the configured Linear dependency and emitted `linear:not_configured`; the earlier aggregate Linear lookup also returned HTTP 400.
- Slack emitted eight message requests plus a digest completion record, producing an unreadable operational dump instead of one summary.
- GitHub annotated deprecated Node 20 action runtimes, an invalid/deprecated GitHub App token input, and a pnpm Node-version fallback.

## Hard constraints

- Exactly five visible phase groups; a task may be declared in only its owning phase.
- Collection and notification must continue when Sentry analysis fails, while the run still reports the analysis failure.
- Claimed human-only findings must reach repair/escalation even if an earlier independent analyzer failed.
- Slack sends one concise digest with bounded representative findings and links to details.
- Provider credentials and unredacted evidence must not enter logs or artifacts.

## Implementation

1. Split the shared all-phases reusable workflow into phase-owned reusable workflows so skipped jobs are not repeated across groups; preserve artifacts and phase ordering.
2. Replace the brittle Sentry structured-output path with a provider invocation/result contract that exposes the actual provider error, retries only retryable failures, and materializes schema-valid output.
3. Preserve full runtime dependencies during enqueue/claim, repair phase failure propagation, and correct Linear request behavior.
4. Replace Slack fan-out with one bounded digest containing overall severity, routine counts, the top actionable findings, escalation/PR status, and the workflow URL.
5. Upgrade pinned GitHub actions to Node 24-capable releases, remove invalid/deprecated GitHub App inputs, and configure pnpm's Node-version lookup explicitly.
6. Add regression tests for phase ownership, failure propagation, Sentry result handling, Linear delivery, and one-message Slack output.

## Verification

- Demonstrate each regression test fails before its corresponding fix and passes after it.
- Run health-agent workflow contract tests and health-agent unit tests.
- Parse every workflow and validate action inputs/pins.
- Run lint and type-check for the changed runtime code.
- Review the complete diff, create a PR, run CI, merge it, then dispatch and monitor a new live production cycle.

## Pre-mortem

- Assumption that can invalidate the repair: the Claude credential is valid for non-interactive SDK use. The workflow must expose a redacted provider error so credential/model rejection is diagnosable instead of being mislabeled as malformed output.
- Silent failure risk: a phase can succeed while dropping findings, notifications, or adapter dependencies. Tests must assert artifact counts and adapter calls at every phase boundary.
