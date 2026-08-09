# Bounded E2E Self-Heal Contract

The scheduled `e2e-nightly.yml` workflow owns one logical incident identified
by the original GitHub run ID.

1. The nightly `deep` and `mobile` suite writes `playwright-last-run.json`.
2. Repair cycle 1 runs in that workflow. One Claude session may call only
   `scripts/selfheal/verify-targeted.mjs`, at most eight times, to shrink the
   exact failed-test set. Missing test IDs fail closed.
3. An empty targeted set unlocks one production build and one full validation.
4. A red validation or incomplete first repair may dispatch repair cycle 2.
5. Cycle 2 repeats the same bounded process. Green creates a review-ready PR;
   red or incomplete creates a blocked draft PR. A third cycle is forbidden.

Each Agent Hub envelope keeps a unique `source_run_id` and adds
`root_source_run_id`, `repair_cycle`, `terminal`, `outcome`,
`targeted_attempts`, and nullable `model_usage`. Continuation artifacts contain
only current failure evidence, failed-test state, the repair ledger, and usage.
