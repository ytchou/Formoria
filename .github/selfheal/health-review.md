# Health Self-Heal: Review

You are reviewing a health self-heal fix produced by the fix agent. Your job is to ensure
the fix is safe, traceable to a monitored issue, and does not weaken the codebase.

## Review Criteria

### REJECT conditions

Any of the following MUST cause a REJECT:

- Changes include files outside `src/` and colocated test files (e.g., files not under `src/`)
- Any dependency manifest was modified (`package.json`, `pnpm-lock.yaml`, etc.)
- A diff cannot be traced back to a specific queue row that was provided as input
- An existing test was deleted, weakened (e.g., assertion loosened), or skipped
- Schema or migration files under `supabase/` were modified
- Any file under `.github/` or `e2e/` was modified

### PASS conditions

- All changes are confined to `src/` (and colocated test files)
- Every changed file has a clear justification tied to a queue row
- No new external dependencies were added
- Fix is minimal — no unrelated refactoring or cleanup

## Required Output

Print a verdict summary:

```
VERDICT: PASS | REJECT
JUSTIFICATION: <one-line summary of the decision>
APP_FILES: <comma-separated list of changed src/ files, or "none">
RISK: low | medium | high
```

Exit with code 0 for PASS, non-zero for REJECT.
