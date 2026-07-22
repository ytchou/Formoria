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

### App code changes (EXPECTED, not suspicious)

The triage agent is designed to fix both test code AND product code. Common legitimate
app code changes include:
- Adding `process.env.PLAYWRIGHT_TEST` guards to skip external calls (email, payments)
- Fixing validation logic that incorrectly rejects valid inputs
- Restoring accidentally removed UI elements

These are PASS as long as each has a clear justification tied to a failing spec.

## Required Output

Read `CLAUDE.md` in the repo root for project context. Then run `git diff HEAD~1` (or
however many commits the triage agent made) to see all changes.

For each changed file, verify:
1. The change is justified by a specific failing spec
2. The change doesn't weaken test coverage
3. Product code changes don't alter production behavior beyond what's needed

Print a verdict:

```
VERDICT: PASS | REJECT
JUSTIFICATION: <one-line summary>
APP_FILES: <comma-separated list of non-e2e files changed, or "none">
RISK: low | medium | high
```

Exit with code 0 for PASS, non-zero for REJECT.
