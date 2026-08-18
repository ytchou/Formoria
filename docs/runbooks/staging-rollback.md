# Staging E2E rollback runbook

If the release gate or Auth capture is unsafe, stop new runs with the shared
`formoria-staging-e2e` concurrency group and disable the staging Send Email
Hook first. Preserve and delete any captured rows with the staging service
role, then roll the staging deployment back to the last known-good SHA.

Restore the prior staging-only workflow only after the deployed revision header
matches that SHA. Never point a rollback, seed, cleanup, or E2E job at the
production URL or Supabase project. Remove the capture migration only after its
rows are audited and deleted; production never needs the hook configuration.
