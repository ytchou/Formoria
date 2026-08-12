# E2E failure triage

What to do when the suite goes red. Run these in order and stop at the first line that answers; the goal is to decide **fix the test** or **fix the app** on evidence rather than on which is easier.

Project-agnostic background — measurement, retries, quarantine, vacuous passes — lives in `~/.claude/context/e2e-testing-philosophy.md` (local, not in this repo). This page is the Formoria-specific procedure.

---

## 1. Read the error string before anything else

These are three different failures and only one of them is about time:

| Playwright says | It means | Do |
|---|---|---|
| `element(s) not found` | The locator matched **nothing** for the whole timeout | Drift, or the app is broken. **A larger timeout cannot fix this.** Go to step 4 |
| `element is not visible` / `not stable` | It exists but never became assertable | The only candidate for a timing story. Continue |
| `expected X received Y` | It rendered the wrong thing | The app changed, or the assertion is stale. Go to step 4 |

DEV-1414 is the cautionary case: a 15s `element(s) not found` on the admin menu was filed as CI contention and previously repaired by raising timeouts. The button was gated behind a client-side waterfall and was never in the DOM at all — no timeout value would have helped.

## 2. Did it fail on every attempt?

CI runs `retries: 1`. **Two consistent failures is not a flake** — stop calling it one and treat it as drift or a real bug.

A single failure that passed on retry is a flake *candidate*, not a diagnosis. One run's evidence is close to worthless (roughly 170 reruns are needed for 95% confidence that a passing test isn't flaky). Check the history:

```bash
node scripts/flake-report.mjs --runs 20
```

## 3. Reproduce against a production build, one worker

```bash
CI=1 pnpm exec playwright test --project=deep e2e/tests/<spec>.spec.ts --repeat-each=5 --retries=0
```

`CI=1` switches the web server to `pnpm start`, which is what CI runs; local `pnpm dev` adds cold-compile and RSC-abort artifacts that look like product bugs but are not. `--retries=0` is deliberate — retries hide the thing you are hunting.

- **Green across 5** → environment or worker contention. Fix the harness, not the assertion.
- **Red** → drift or genuine bug. Continue.

## 4. Did the app change?

```bash
git log --oneline <last-green-sha>..HEAD -- src/app src/components src/lib
```

- App changed, and the change was **intended and correct** → the test is stale. Fix the test, in the same PR as the change ideally (see the drift rules in the philosophy doc).
- App changed and **nobody intended it** → **genuine bug. Fix the app.**
- App did not change → look at seed data, env, and the shared Supabase project before touching the spec.

## 5. Would a real user notice?

This question, not the stack trace, separates the two cases:

- The admin menu takes 18 seconds to appear → **a user notices. Product bug.**
- A button label was intentionally renamed `編輯欄位` → `編輯` → **no user is affected. Test drift.**

## 6. A timeout is a product SLO assertion, not a test knob

Writing `timeout: 15_000` asserts that fifteen seconds is an acceptable experience for that interaction. It usually is not.

**A raise is legitimate in exactly one case:** you measured p95 latency, the new budget clears it with headroom, *and* that latency is one you are willing to ship. If the measured latency is not shippable, the fix is the app. "The number was too small" is never a complete diagnosis.

This is enforced, not merely advised — see [Enforcement](#enforcement).

## 7. Replace the number with a condition

If you cannot name what you are waiting *for*, you do not understand the test well enough to be changing its timeout. Name it:

| Waiting for | Use |
|---|---|
| An element to render | `await expect(locator).toBeVisible()` |
| A value to settle | `await expect.poll(() => …)` |
| Several assertions to hold together | `await expect(async () => {…}).toPass(POLL.DB)` |
| Auth/role state to resolve | `await waitForViewerReady(page)` |
| Time to pass | `page.clock` — never `waitForTimeout` |

**When a failure has two or more causes you cannot distinguish, the missing thing is a readiness signal, not a bigger number.** `e2e/helpers/viewer-ready.ts` is the worked example: admin- and owner-gated controls render `null` until viewer context resolves, so "still loading", "resolved and hidden", and "the fetch threw" were one indistinguishable timeout. The app now publishes `data-viewer-state="loading|error|ready"`; specs gate on it and then assert at `BUDGET.RENDERED`, and a failed fetch reports as itself.

---

## Budgets

Timeouts live in `e2e/budgets.ts` as named budgets — one name per *thing being waited on*, never per duration. Use the name that describes what you are waiting for; if none fits, that is a signal about the test, not a reason for a literal.

Poll ladders live in the same file. The interval array matters as much as the ceiling: a ladder that starts later can miss a window that closes early while still passing, which produces a flake at a rate low enough to be blamed on CI noise. **Never change a ladder and a ceiling in the same commit.**

## Enforcement

`scripts/check-e2e-timeouts.mjs` runs in the `lint` job and fails closed on:

1. Any numeric `timeout` value outside `e2e/budgets.ts`.
2. Any unresolved or dynamic custom timeout argument, including `test.setTimeout`.
3. Inline polling interval arrays outside `e2e/budgets.ts`.
4. Hard sleeps (`waitForTimeout` and `setTimeout`) in E2E code.
5. Bare `toPass()` calls or custom `toPass`/`expect.poll` policies that are not named `POLL.<NAME>` uses.

Numeric definitions are allowed only in `e2e/budgets.ts`; every other E2E file
must use a named `BUDGET.*` or `POLL.*` policy. The guard is syntax-based and
does not maintain a generated census or baseline, so adding a new wait cannot
be made acceptable by updating an artifact.

`eslint-plugin-playwright` runs over `e2e/` against the baseline in `eslint-suppressions.json`. New conditional logic, skipped tests, and assertion-free tests fail the build; the baseline only shrinks.

## What not to do

- **Do not quarantine by flake history.** Classifying tests by past failures discards the failures that carry real regressions. Fix it or delete it — deleting a test you would not act on is a legitimate repair, not a defeat.
- **Do not add `retries` to make a spec pass.**
- **Do not add a runtime skip whose condition is the thing the test should assert.** "Skip if no rows" is the empty-results bug, tolerated.
- **Do not assert layout geometry.** `boundingBox()` with a pixel tolerance reads layout mid-settle. Assert containment or document order instead.
