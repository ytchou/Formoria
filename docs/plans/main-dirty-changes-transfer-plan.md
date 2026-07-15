# Main Dirty Changes Transfer Plan

1. Snapshot the primary `main` checkout and compare every tracked and untracked path with PR #356.
2. Transfer the five changes not already represented in the PR: retire Mention Tracker routine configuration, align the routine contract test, soften the global radius token, and update the default button radius.
3. Review callers and affected tests, update only genuine drift, and run scoped Agent Hub/UI verification.
4. Run branch-wide TypeScript, lint, Knip, unit tests, and diff/secret checks.
5. Verify the linked worktree contains every primary dirty change, then remove only the successfully transferred changes from primary `main`.
6. Commit, push, update PR #356 title/body, and monitor all rerun checks.
