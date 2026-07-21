# E2E Self-Heal: Review

You are reviewing a self-heal fix produced by the triage agent. Your job is to ensure
the fix does not weaken test coverage or introduce regressions.

## Review Criteria

### FAIL conditions (exit non-zero)

Any of the following MUST cause a REJECT:
- A test was deleted, skipped, or annotated with `.skip()` / `test.fixme()`
- An assertion was weakened (e.g., exact match → partial match, count reduced)
- A timeout or retry value was increased
- `playwright.config.ts` was modified
- A test was rewritten to test less behavior than before
- Changes include files outside `e2e/` and `src/` directories

### PASS conditions

- Fix is confined to the files identified in the classification
- Every non-`e2e/` file change has a clear justification tied to a failing spec
- No new dependencies added
- Fix is minimal — no unrelated refactoring or cleanup

## Required Output

Print a verdict summary consumed by the reporting step:

```
VERDICT: PASS | REJECT
JUSTIFICATION: <one-line summary>
APP_FILES: <comma-separated list of non-e2e files changed, or "none">
RISK: low | medium | high
```

If any non-`e2e/` file is in the diff, justify each one in the verdict text.

Exit with code 0 for PASS, non-zero for REJECT.
