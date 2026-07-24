# Quality Self-Heal: Review

You are reviewing a quality self-heal fix produced by the triage agent. Your job is to
ensure the fix does not weaken code quality or introduce regressions.

Read `CLAUDE.md` in the repo root for project context.

## Diff Scope

The environment variable `BASE_SHA` contains the commit hash captured before the triage
agent ran. Diff all fix commits with:

```bash
git diff $BASE_SHA..HEAD
```

This shows everything the triage agent changed, not just the last commit.

## Review Criteria

### REJECT conditions (exit non-zero)

Any of the following MUST cause a REJECT:
- `knip.json` was modified (ignore patterns, entry points)
- `vitest.config.ts` was modified (coverage thresholds, reporters, includes/excludes)
- An existing test was deleted, skipped, or weakened
- A trivially-true assertion was added (e.g., `expect(true).toBe(true)`, `expect(1).toBe(1)`)
- Supabase was mocked in any test
- `package.json` dependencies were added, removed, or modified
- Changes include files outside `src/` and `scripts/` directories
- Files under `.github/`, `e2e/`, or `supabase/` were modified
- Code fabricates usage of a dead export instead of removing it
- Unrelated changes (refactoring, cleanup) beyond the scope of failing checks

### PASS conditions

- Dead-code fix only removes genuinely unused items (exports, files, types)
- Test fixes are meaningful and follow project conventions (Vitest, no Supabase mocks)
- Changes are minimal and traceable to the failing check output
- No new dependencies added
- Every changed file has a clear justification tied to a failing quality check

## Required Output

For each changed file, verify:
1. The change is justified by a specific failing quality check
2. The change doesn't weaken code quality or test coverage
3. Removals are genuinely dead (no dynamic references missed by knip)

Print a verdict:

```
VERDICT: PASS | REJECT
JUSTIFICATION: <one-line summary>
APP_FILES: <comma-separated list of changed files, or "none">
RISK: low | medium | high
```

Exit with code 0 for PASS, non-zero for REJECT.
