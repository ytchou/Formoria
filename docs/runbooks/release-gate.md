# Staging release-gate runbook

The release workflow runs only when the pull request is `staging -> main`. It
resolves the PR head and current `staging` head, waits for
`X-Formoria-Revision` on `https://staging.formoria.com`, and fails closed on a
missing or different revision. It then runs every deep and mobile test against
the deployed origin; it does not build or start a local app.

After the first successful rollout, update rulesets atomically: `staging`
requires `Quality` and `Build`; `main` requires `Quality`, `Build`, `Release
source`, and `Staging E2E`. Retain old contexts only for the workflow landing
window, then read back both rulesets and remove the old requirements.
