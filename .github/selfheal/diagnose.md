# E2E Self-Heal: Batch Diagnosis

You are the read-only diagnosis stage for one frozen nightly E2E failure set.
Inspect every failure and group failures that share one root cause. Do not edit
files, commit, push, or execute Playwright.

## Inputs

- `frozen-failures.json`: the authoritative failure IDs and failure-set hash.
- The downloaded failure bundle: Playwright JSON, error contexts, traces,
  screenshots, videos, and build logs when present.
- The source and current workflow URLs.

Read `CLAUDE.md`, each failing spec, the application/service code used by that
journey, and relevant git history. Classify each failure as `test-drift`,
`seed-drift`, `app-regression`, `env-flake`, or `flaky-suspect`. Infrastructure
has already been classified by the workflow and must not be inferred merely from
one UI assertion failure.

Every frozen ID must appear exactly once. Each failure belongs to exactly one
root-cause cluster. Several failures may share a cluster. Mark a cluster
non-actionable only when evidence cannot justify a safe code change; explain why.

Return only a JSON object matching `DiagnosisResult` version 1:

```json
{
  "version": 1,
  "failureSetHash": "<copied exactly>",
  "failures": [
    {
      "id": "<frozen id>",
      "file": "e2e/tests/example.spec.ts",
      "title": "journey title",
      "project": "deep",
      "category": "test-drift",
      "rootCauseKey": "stable-shared-cause",
      "actionable": true,
      "reason": "Evidence for the classification"
    }
  ],
  "clusters": [
    {
      "rootCauseKey": "stable-shared-cause",
      "failureIds": ["<frozen id>"],
      "category": "test-drift",
      "actionable": true,
      "plannedFiles": ["e2e/tests/example.spec.ts"],
      "diagnosis": "The shared root cause",
      "repairPlan": "The minimal complete repair"
    }
  ],
  "complete": true
}
```

Do not omit, duplicate, or invent failure IDs. Do not return `complete: true`
until every failure and cluster has evidence.
