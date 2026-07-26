# Health-agent phase boundaries

## Symptom

A five-phase controller called one reusable workflow five times. GitHub rendered every job from that reusable workflow in every phase, and downstream repair was skipped after a handled analysis failure. Later, notifications were emitted before repair and Sentry title text produced queue fingerprints longer than the database-safe identity limit.

## Cause

- GitHub determines the job graph from declarations, not from job-level `if` conditions; skipped jobs still belong to every reusable-workflow invocation.
- The controller omitted `always()` on a downstream phase, so a skipped or failed dependency prevented its condition from being evaluated as intended.
- The queue reused unbounded human-readable Sentry text as a machine identity.
- Collector, repair, and publish jobs each owned delivery credentials, so Slack and Agent Hub received partial reports before the terminal outcome existed.

## Prevention

- Give each visible phase its own reusable workflow and declare each job in exactly one file.
- Test downstream phase conditions explicitly when an independent upstream phase fails.
- Derive bounded opaque fingerprints from provider IDs or deterministic hashes; never use titles as queue identities.
- Keep delivery credentials in the terminal reporting job. Earlier phases produce artifacts only.
- Keep notification adapters bounded: summarize each check by count and severity, include repair totals, and link to detailed artifacts instead of forwarding individual findings.

## How to apply

When adding a health-agent task, place it only in its owning phase workflow, emit a redacted artifact for terminal reporting, and extend the workflow contract tests to prove unique ownership, bounded identities, one final delivery, and intended failure propagation.
