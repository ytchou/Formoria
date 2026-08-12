# ADR: Batch E2E Self-Heal and Test-Only Self-Merge

Status: accepted

## Decision

Nightly E2E repair uses a mechanically enforced `diagnose all → fix all → verify
once` cycle. Repair is capped at three cycles. Confirmed infrastructure failures
have a separate incident-wide allowance of two validation-only retries.

One draft PR is the durable incident record after the first code checkpoint.
Automatic squash merge is permitted only for safe TypeScript files below `e2e/`
after exact-set, build, full-suite, independent-review, branch-currentness, and
named-check gates all pass. Application and mixed repairs remain review-ready.

## Context

The previous agent both edited and repeatedly executed the shrinking set. That
made an incident a series of local guesses, spent validation time between related
fixes, and mixed service outages with code-repair budgets. It also had no policy
boundary strong enough to allow safe automated merging.

## Consequences

- One validation run evaluates a complete repair hypothesis.
- Service outages do not consume repair cycles or prompt code edits.
- Test-only drift can recover without a human merge while application changes
  still receive full evidence and mandatory human review.
- The workflow is more stateful: versioned artifacts, current head SHAs, retry
  counters, and the PR body must remain consistent across continuations.

## Pre-mortem

The design fails entirely if a continuation can lose or replace the frozen
failure set. Hash and membership validation therefore fail closed before edits or
verification. The principal silent break is a green result obtained by reducing
coverage, so structural diff policy and skipped/test/assertion counts are merge
gates independent of Playwright success.

