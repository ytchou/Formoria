# Batch E2E Self-Heal Implementation Plan

## Wave 1: contracts

- Add versioned incident types and pure validation/state/policy/rendering helpers.
- Add a CLI used by GitHub Actions.
- Cover exact failure membership, shared clusters, hashes, retry caps, unsafe
  changes, coverage weakening, outcomes, and PR rendering with Vitest.

Verification: `pnpm vitest run scripts/selfheal/incident.test.ts`.

## Wave 2: split agent responsibilities

- Add a read-only diagnosis prompt.
- Convert the triage prompt to batch repair with no Playwright access.
- Make the workflow validate both artifacts and run exact verification once.
- Add infrastructure probing and validation-only continuation inputs.

Verification: changed self-heal and workflow contract suites.

## Wave 3: durable PR, merge, and reporting

- Create/reuse one draft PR, continuously render its incident body, and retain or
  close the nightly issue according to the terminal outcome.
- Enforce current-head review/check/base policy and squash merge without bypass.
- Expand Slack terminal outcomes and Agent Hub incident fields while keeping
  continuations silent.

Verification: changed workflow and Slack suites, workflow YAML parse, lint, and
`pnpm tsc --noEmit`.

## Dependency sweep

Touched workflow contracts are asserted by
`scripts/agent-hub/e2e-workflow.test.ts`; Slack rendering is owned by
`scripts/notifications/e2e-slack.ts`; exact Playwright selection is owned by
`scripts/selfheal/verify-targeted.mjs`. No component, route, database, or external
SDK business flow changes.

