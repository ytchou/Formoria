# Health-agent phase boundaries

## Symptom

A five-phase controller called one reusable workflow five times. GitHub rendered every job from that reusable workflow in every phase, and downstream repair was skipped after a handled analysis failure. Runtime queueing also reported `linear:not_configured` even though the workflow supplied Linear configuration.

## Cause

- GitHub determines the job graph from declarations, not from job-level `if` conditions; skipped jobs still belong to every reusable-workflow invocation.
- The controller omitted `always()` on a downstream phase, so a skipped or failed dependency prevented its condition from being evaluated as intended.
- A compatibility wrapper narrowed the runtime dependency object to `{ queue }`, silently dropping the Linear adapter.

## Prevention

- Give each visible phase its own reusable workflow and declare each job in exactly one file.
- Test downstream phase conditions explicitly when an independent upstream phase fails.
- Pass the complete dependency object across orchestration boundaries; add adapter-call regressions for required integrations.
- Keep notification adapters bounded: summarize counts and representative findings, and link to detailed artifacts instead of forwarding raw evidence.

## How to apply

When adding a health-agent task, place it only in its owning phase workflow, preserve full dependencies in shared runtime calls, and extend the workflow contract test to prove unique ownership and intended failure propagation.
