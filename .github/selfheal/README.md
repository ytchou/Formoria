# Staging E2E self-heal contract

The nightly workflow freezes the complete deployed-staging failure set and
records both the deployed app SHA and the repair-test SHA. A missing or stale
`X-Formoria-Revision` is an infrastructure block, never evidence for a repair.

Infrastructure is probed independently and may be retried at most twice. A
repair is classified by the exact SHA range: only TypeScript files under
`e2e/**/*.ts` can be verified against the currently deployed staging app. Any
`src/**`, mixed, deleted, or renamed repair is `review_ready`; the deployed
staging run cannot certify application code that has not been deployed.

Test-only repairs run the complete deep/mobile suite against staging and may
merge only to `staging`, after one reused incident PR has an independent
approval and the head SHA still matches. The merge uses
`--match-head-commit` and never an admin bypass. Human application repairs are
verified authoritatively by the next nightly or release-gate run after they
land and deploy.

GitHub Actions emits one initial E2E notification and one terminal self-heal
notification with one of `merged`, `review_ready`, `recovered_no_change`,
`infrastructure_blocked`, or `repair_blocked`. No production URL, credential,
build, or local server is part of this flow.
