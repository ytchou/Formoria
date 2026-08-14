/**
 * Wait budgets for the e2e suite.
 *
 * One name per thing-being-waited-on, never per duration. A spec that needs
 * longer than the name it is using is telling you the name is wrong, or that the
 * app got slower — both are worth knowing, and a bare literal hides both.
 *
 * `scripts/check-e2e-timeouts.mjs` permits numeric definitions only in this
 * file. See `e2e/TRIAGE.md` for when changing a value is legitimate at all.
 *
 * This module is imported by `playwright.config.ts`, so it must stay free of
 * runtime dependencies — flat `as const` literals only.
 */

export const BUDGET = {
  /**
   * DOM already on screen: text, attribute, count, aria-state on an element a
   * prior assertion has established. No network, no hydration.
   *
   * This is also Playwright's own default, restated as `expect.timeout` in the
   * config so it is greppable — ~537 assertions in this suite carry no explicit
   * timeout and land here.
   */
  RENDERED: 5_000,

  /** Client-side reaction to an interaction: a dialog opens, a toast appears, a
   *  control re-renders, a client-side route push settles. Hydration has happened. */
  INTERACTIVE: 10_000,

  /** First paint of server-rendered content on a public route. */
  SERVER_RENDER: 15_000,

  /**
   * Content behind an auth or role gate, where the session must resolve before
   * the UI can render at all. /admin/brands measures 5-6.5s under CI load
   * (DEV-1312).
   *
   * Deliberately generous because it also had to absorb the viewer-context
   * round trips. Now that `waitForViewerReady` gates on an explicit readiness
   * signal (DEV-1414), assertions after that wait should use RENDERED instead —
   * this budget is for reaching the gated surface, not for what is on it.
   */
  GATED_UI: 30_000,

  /** A route landing: page.goto, waitForURL, and the first assertion proving the
   *  new route rendered. Mirrors `use.navigationTimeout` in playwright.config.ts. */
  NAVIGATION: 60_000,

  /** Browser warm-up before the suite starts; cold dev bundles can compile slowly. */
  WARMUP: 120_000,

  /** Whole-test budgets, passed to test.setTimeout. */
  TEST: {
    /** A read-only journey across one to three public routes. */
    JOURNEY: 60_000,
    /** A journey that writes and then re-reads through the database. */
    MUTATION: 90_000,
    /** An admin journey: signed-in state, a gated route, and an apply action. */
    ADMIN: 120_000,
    /** Claim lifecycle: upload, review, storage cleanup. */
    CLAIM: 180_000,
  },
} as const

/**
 * Poll ladders for `expect(...).toPass` and `expect.poll`.
 *
 * The ceiling is the budget; the intervals encode how fast the underlying thing
 * settles, and are the part people change without noticing. A ladder that starts
 * later can miss a window that closes early while still passing — a flake at a
 * rate low enough to be blamed on CI noise. Never edit a ladder in the same
 * commit as a ceiling change.
 *
 * ⚠️ `toPass` defaults to a timeout of **0**, not the expect timeout — a bare
 * `toPass()` retries until the whole test dies. Always pass one of these.
 * (`expect.poll` does inherit the expect timeout. The two are not symmetric.)
 */
export const POLL = {
  /** Server or database state read back through a reloaded page: ISR and the
   *  router cache can serve one render behind a mutation. */
  DB: { timeout: 60_000, intervals: [3_000, 5_000, 10_000] },
  /** Client re-render races: React reconciliation, third-party widget callbacks. */
  UI: { timeout: 20_000, intervals: [500, 1_000, 2_000] },
  /** An admin apply action propagating to the row it edited. */
  APPLY: { timeout: 30_000, intervals: [1_000, 2_000, 5_000] },
  /** The claim state machine: upload, review, storage cleanup. */
  CLAIM: { timeout: 120_000, intervals: [2_000, 3_000, 5_000, 10_000] },
  /** A submit flow whose server action can take several seconds to settle. */
  SUBMIT: { timeout: 90_000, intervals: [2_000, 4_000, 8_000] },
  /** A route transition that may include a cold server-side compile. */
  NAVIGATION: { timeout: 60_000, intervals: [500, 1_000, 2_000, 5_000] },
  /** A submission or board write observed through a reload. */
  BOARD: { timeout: 60_000, intervals: [1_000, 2_000, 3_000, 5_000] },
  /** A staging Auth hook row becoming visible through the service-role API. */
  AUTH_CAPTURE: { timeout: 30_000, intervals: [250, 500, 1_000] },
} as const
