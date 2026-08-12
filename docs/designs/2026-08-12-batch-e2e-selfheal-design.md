# Batch E2E Self-Heal Design

## Goal

Treat a red nightly deep/mobile run as one incident. Each repair cycle freezes the
complete failing Playwright ID set, diagnoses every member without edits, applies
all actionable root-cause repairs as one checkpoint, and verifies that exact set
once. A green exact set then passes one production build and one complete
deep/mobile run.

## Incident flow

1. The nightly job creates a versioned failure bundle and root incident ID.
2. A structured Supabase probe and known error signatures classify infrastructure
   before an agent is dispatched. Confirmed infrastructure failures receive at
   most two validation-only continuations and consume no repair cycle.
3. The diagnosis agent is read-only and emits `DiagnosisResult` version 1. The
   workflow validates exact failure membership, clusters, and the frozen hash.
4. The repair agent receives the validated diagnosis and may edit only `e2e/**`
   and `src/**`. It cannot run Playwright. The workflow validates `RepairResult`
   version 1 and the declared working-tree paths before checkpointing.
5. The workflow calls `verify-targeted.mjs` exactly once. It uses Playwright's
   `--last-failed` and `--last-failed-file` selectors and fails when stored IDs
   can no longer be collected.
6. Exact-set green is followed by one production build and one unselected
   deep/mobile suite. Remaining non-infrastructure failures begin the next cycle,
   up to three total repair cycles.

## Durable record

The first non-empty checkpoint creates one draft PR. Later continuations reuse its
branch and PR and replace the generated incident body with current diagnoses,
cycle commits, validation evidence, retry counts, and merge policy. An incident
with no code continues on the existing `e2e-nightly` issue instead of opening an
empty PR.

## Merge boundary

Workflow-controlled squash merge is limited to changed `e2e/**/*.ts` files and
diagnosed `test-drift`/`seed-drift`. It fails closed on renamed/deleted specs,
skips, focused/fixme tests, timeout or retry increases, reduced test/assertion
counts, increased skipped results, stale review evidence, missing checks, or a
head not based on current `main`. Any application or mixed repair stops as a
green `review_ready` PR.

## Silent failures

The dangerous silent failures are stale evidence and weakened coverage that still
produces green tests. All validation and review evidence therefore carries the PR
head SHA, and eligibility is recomputed after any base sync. A two-attempt base
sync cap hands the incident to a human instead of merging uncertain evidence.

