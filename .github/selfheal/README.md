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

## Notification ownership

GitHub Actions is the sole Slack owner for this incident. The nightly job sends
one initial message; the terminal job sends exactly one final ready or blocked
message after all repair cycles finish. Repair cycles do not call Slack.

Agent Hub receives every initial and self-heal envelope as the silent ledger and
keeps `data.notification_owner: "github_actions"` so its notifier suppresses a
duplicate message. A blocked draft PR still belongs to the blocked terminal
message; a PR URL alone never makes a terminal result ready.

Cycle-2 dispatches carry `source_failure_state` (the prior count and failed
specs) so a guard-skipped terminal can still report the remaining failures
without downloading context. Manual `selfheal_only` runs that may skip before
artifact setup should provide the same JSON input.

## Canary lesson: targeted server mode

- **Symptom:** A repair agent could collect a stored test ID but could not run
  it because Playwright attempted `next start` without a production build.
- **Cause:** The sanctioned helper inherited `CI=true`, so the shared
  Playwright config selected the workflow-only production server path.
- **Prevention:** `verify-targeted.mjs` marks its child Playwright processes
  with `SELFHEAL_TARGETED=true`; the config uses the development server for
  that mode while the workflow remains the sole owner of production builds.
- **How to apply:** Contract-test both the helper marker and server selection,
  and determine terminal notifications from `blocked_reason`, not merely from
  whether a PR URL exists because blocked draft PRs also have URLs.
