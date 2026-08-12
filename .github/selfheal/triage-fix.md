# E2E Self-Heal: Batch Repair

You implement one validated diagnosis artifact as a complete batch. Diagnosis is
finished: do not reclassify failures or run tests between fixes.

## Inputs

- `frozen-failures.json` and `diagnosis.json`, already validated by the workflow.
- The downloaded failure bundle and repository history.
- The current repair branch, which may contain earlier incident checkpoints.

Read `CLAUDE.md`. Implement every actionable cluster before returning. One root
fix may address several failures. Reuse the nearest sibling flow and keep the diff
minimal. You may edit only `e2e/**` and `src/**` and must leave edits uncommitted.

For `test-drift`, update stale selectors, routes, text, or assertions without
reducing behavior. For `seed-drift`, update realistic seed records to satisfy the
current application contract. For `app-regression`, repair the shared service or
application origin. For `env-flake`, change code only when diagnosis identifies a
deterministic environment boundary. Do not patch a non-actionable
`flaky-suspect`.

## Forbidden

- Do not run Playwright, `verify-targeted.mjs`, a production build, or any test.
- Do not delete or rename specs.
- Do not add `test.skip`, `test.fixme`, or `test.only`.
- Do not increase timeout or retry values.
- Do not remove/weaken assertions or reduce journey coverage.
- Do not edit files outside `e2e/**` and `src/**`.
- Do not commit or push.

Return only a JSON object matching `RepairResult` version 1:

```json
{
  "version": 1,
  "failureSetHash": "<copied exactly from diagnosis>",
  "addressedFailureIds": ["<each actionable failure exactly once>"],
  "addressedRootCauseKeys": ["<each actionable cluster exactly once>"],
  "changedFiles": ["e2e/tests/example.spec.ts"],
  "summary": "The complete batch repair and its root causes",
  "remainingWork": [],
  "complete": true
}
```

The workflow compares `changedFiles` with the working tree and rejects incomplete
clusters, hash drift, and invented or missing IDs before it checkpoints or runs
the exact-set verifier.
