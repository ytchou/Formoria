# Batch E2E Self-Heal Contract

The original nightly GitHub run ID identifies one incident. The workflow freezes
the complete failure set, validates a read-only `DiagnosisResult`, validates one
complete batch `RepairResult`, and calls `verify-targeted.mjs` exactly once per
repair cycle. The helper proves stored Playwright IDs remain collectible and its
test invocation contains both `--last-failed` and `--last-failed-file`.

A green exact set unlocks one production build and one complete, unselected
`deep` + `mobile` suite. A remaining non-infrastructure set starts the next
cycle. Three repair cycles are permitted; a fourth is forbidden.

Confirmed infrastructure failures do not dispatch either agent and do not
consume repair cycles. The workflow logs a credential-free structured Supabase
probe audit and permits two incident-wide validation-only retries. Persistent
failure ends as `infrastructure_blocked`.

The first non-empty checkpoint creates one draft PR. All continuations reuse its
branch and PR. Safe test/seed drift confined to `e2e/**/*.ts` may be squash-merged
only after structural anti-weakening policy, exact/build/full validation,
independent low-risk review of the current head, current-main ancestry, and the
named protected checks pass. The merge uses `--match-head-commit` and never an
admin bypass. `src/**`, mixed, and otherwise unsafe repairs end `review_ready`.

## Reporting ownership

GitHub Actions sends one initial Slack message and one terminal message with one
of `merged`, `review_ready`, `recovered_no_change`, `infrastructure_blocked`, or
`repair_blocked`. Infrastructure, repair, and base-sync continuations are silent.
Agent Hub remains the per-run incident ledger and distinguishes merge eligibility
from an actual merge and merge commit SHA.
