import { defineConfig, devices } from "@playwright/test";
import { BUDGET } from "./e2e/budgets";

// Load .env.local so global-setup can access env vars outside the Next.js runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

// Disable dev-only widgets (e.g., Agentation) during test runs. This flag no
// longer gates any SECURITY behaviour -- `src/proxy.ts` and
// `src/lib/security/turnstile.ts` read the two granular switches below instead.
process.env.PLAYWRIGHT_TEST = "true";

/**
 * Granular security switches (DEV-1551 task 17), replacing the single
 * `PLAYWRIGHT_TEST` gate. Both default to the effective state that one flag
 * produced, so no existing spec changes.
 *
 * They are set as env vars rather than hardcoded, so a Playwright PROJECT can
 * override one without the other:
 *
 *   SECURITY_DISABLE_RATE_LIMIT=false pnpm test:e2e --project=adversarial
 *
 * That is only possible because both names are threaded into the `webServer`
 * command below. The dev server is SHARED across projects, so a value set only
 * in this Node process never reaches the runtime that enforces the gate -- the
 * exact reason the old single flag could not be turned back on per project.
 */
const securityGates = {
  SECURITY_DISABLE_RATE_LIMIT: process.env.SECURITY_DISABLE_RATE_LIMIT ?? "true",
  SECURITY_STUB_TURNSTILE: process.env.SECURITY_STUB_TURNSTILE ?? "true",
};
for (const [name, value] of Object.entries(securityGates)) {
  process.env[name] = value;
}
const securityGateEnv = Object.entries(securityGates)
  .map(([name, value]) => `${name}=${value}`)
  .join(" ");

const baseURL =
  process.env.BASE_URL ??
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.STAGING_BASE_URL ??
  "http://localhost:3000";
const isLocalTarget = ["localhost", "127.0.0.1", "::1"].includes(
  new URL(baseURL).hostname,
);
const isTargetedSelfheal = process.env.SELFHEAL_TARGETED === "true";
const remoteHeaders = Object.fromEntries(
  [
    ["CF-Access-Client-Id", process.env.CF_ACCESS_CLIENT_ID],
    ["CF-Access-Client-Secret", process.env.CF_ACCESS_CLIENT_SECRET],
  ].filter((entry): entry is [string, string] => Boolean(entry[1])),
);

// Ensure the E2E admin account is in ADMIN_EMAILS so isAdmin() passes during tests
if (process.env.E2E_ADMIN_EMAIL && process.env.ADMIN_EMAILS) {
  const emails = process.env.ADMIN_EMAILS.split(",").map((e) =>
    e.trim().toLowerCase(),
  );
  const e2eAdmin = process.env.E2E_ADMIN_EMAIL.trim().toLowerCase();
  if (!emails.includes(e2eAdmin)) {
    process.env.ADMIN_EMAILS = `${process.env.ADMIN_EMAILS},${process.env.E2E_ADMIN_EMAIL}`;
  }
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // ubuntu-latest has 4 vCPU. Five spec files set `describe.configure({ mode:
  // 'serial' })` and pin to a single worker regardless (they carry ownership
  // constraints — see dashboard-brand-owned-edit.spec.ts), so raising this
  // caps out well below 4x.
  //
  // Locally, Playwright would default to half the cores. Against `pnpm dev`
  // concurrent journeys oversubscribe one Turbopack process: pages get torn
  // down with RSC fetches still in flight, and the aborted response
  // (ECONNRESET server-side) reaches the client as a truncated flight payload.
  // Keep local deep runs deterministic; production CI retains its parallel
  // worker count.
  workers: process.env.CI && !isTargetedSelfheal ? 4 : 1,
  reporter: "html",
  // CI serves a production build via `pnpm start`, so every route is already
  // compiled and 30s is a real budget. Locally `webServer` runs `pnpm dev`,
  // which compiles each route on demand while parallel workers race the same
  // cold compile — that alone can push a first `page.goto` past 30s. Keep CI
  // strict so a genuine regression still fails there.
  timeout: process.env.CI && !isTargetedSelfheal ? 30_000 : 60_000,
  expect: {
    // Playwright's own default, restated so it is greppable and so any change
    // to it shows up in a diff. Around 540 assertions in e2e/ carry no explicit
    // timeout and land here; raising this silently lengthens every one of them
    // and hides regressions in exactly the 5-10s band where /admin/brands
    // already sits. Anything that needs longer states its own budget.
    timeout: BUDGET.RENDERED,
  },
  use: {
    baseURL,
    // Vestigial as of DEV-1580: the proxy no longer infers a locale from
    // Accept-Language or cf-ipcountry, so a prefix-free public path is the
    // default locale whatever this header says. It was added because the
    // `request` fixture is an APIRequestContext, inherits none of `use.locale`
    // below, and so sent no Accept-Language at all -- which used to 307 every
    // public path to /en/... from a US-hosted runner. Kept because it is inert
    // and because it still makes the API fixture match a real browser.
    extraHTTPHeaders: {
      "Accept-Language": "zh-TW",
      ...(isLocalTarget ? {} : remoteHeaders),
    },
    // Not 'on-first-retry': with retries=1 a fail-then-pass keeps only the
    // passing attempt's trace, which is how flakes became unfixable after
    // the fact. Retain the attempt that actually failed.
    trace: "retain-on-failure",
    locale: "zh-TW",
    // Pinned alongside locale. event-detail.spec.ts asserts a raw Taipei
    // calendar date in Event JSON-LD and was correct only because CI happens to
    // run UTC — an unpinned timezone makes that assertion depend on where it
    // runs, which is the one genuine day-boundary hazard in the suite.
    timezoneId: "Asia/Taipei",
    // 74 of the 86 explicit goto timeouts were already exactly this, so for
    // them it changes nothing and lets the argument be deleted. For the 168
    // gotos that carried no ceiling at all it replaces "however long the test
    // budget allows" with a real bound, which is what makes a hung navigation
    // report as itself instead of as whichever assertion ran out of time.
    navigationTimeout: 60_000,
  },
  projects: [
    // Deep: the canonical suite, including smoke-tagged cases, runs in Chrome.
    {
      name: "deep",
      testMatch: "e2e/tests/**/*.spec.ts",
      testIgnore: [
        // Assert limiter behaviour, so they belong to the `anti-enumeration`
        // project. Left in `deep` they would run with the gates off and pass
        // without proving anything.
        "e2e/tests/anti-enumeration-*.spec.ts",
        /*
         * Owned by `playwright.visual.config.ts`, which pins its own local dev
         * server and a `snapshotPathTemplate` with no project/platform segment.
         * Run from `deep` it gets Playwright's default `-{projectName}-{platform}`
         * naming and looks for baselines that were never committed under that
         * name -- and pixel baselines rendered locally mean nothing compared
         * against deployed staging anyway. Use `pnpm test:visual`.
         */
        "e2e/tests/visual-regression.spec.ts",
      ],
      use: { ...devices["Desktop Chrome"] },
    },
    // Compatibility: exactly the one tagged journey, selected independently
    // from the smoke subset so smoke cases cannot multiply across browsers.
    {
      name: "cross-browser-chromium",
      testMatch: "e2e/tests/landing-search-cross-browser.spec.ts",
      grep: /@cross-browser/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "cross-browser-firefox",
      testMatch: "e2e/tests/landing-search-cross-browser.spec.ts",
      grep: /@cross-browser/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "cross-browser-webkit",
      testMatch: "e2e/tests/landing-search-cross-browser.spec.ts",
      grep: /@cross-browser/,
      timeout: 60_000,
      use: { ...devices["Desktop Safari"], navigationTimeout: 45_000 },
    },
    /*
     * Anti-enumeration (DEV-1551 task 18). The ONLY project that expects the
     * rate limiter to be ON, which is why its specs are excluded from `deep`:
     * under the default gates they would assert nothing and pass trivially.
     *
     * The switch has to reach the SERVER, not just this process -- the dev
     * server is shared across projects. So this project cannot arm the limiter
     * by itself; run it with the gate in the environment so `webServer` picks
     * it up:
     *
     *   SECURITY_DISABLE_RATE_LIMIT=false pnpm exec playwright test --project=anti-enumeration
     *
     * Turnstile stays stubbed by default so the human matrix can prove "no
     * challenge was issued" without solving one. To exercise a real failed
     * verification, add SECURITY_STUB_TURNSTILE=false and point at
     * Cloudflare's published always-fail test key.
     */
    {
      name: "anti-enumeration",
      testMatch: "e2e/tests/anti-enumeration-*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // A remote BASE_URL means synthetic monitoring against an already-deployed
  // origin — there is nothing to boot locally, and booting anyway either
  // computes an empty PORT (https URLs carry no port) or wastes a CI build.
  webServer: isLocalTarget
    ? {
        // The gate vars must be on EVERY branch, not just CI. `proxy.ts` skips
        // the soft rate limiter only when the SERVER sees them, and
        // SOFT_LIMIT_PREFIXES is ['/brands/'] keyed by client IP — every local
        // worker shares 127.0.0.1, so the deep suite trips the limit partway
        // through and Next rewrites the rest of its /brands/* requests to
        // /challenge. Specs then poll a "快速驗證" interstitial until they time out,
        // and which specs get hit shifts run to run. Setting them in this file's
        // process is not enough to reach the dev server's proxy runtime.
        //
        // PLAYWRIGHT_TEST stays on the command line for the NON-security uses
        // that still read it (test token hashes, generateStaticParams skips,
        // dev-widget suppression). It no longer decides either gate.
        command:
          process.env.CI && !isTargetedSelfheal
            ? `PLAYWRIGHT_TEST=true ${securityGateEnv} pnpm start`
            : process.env.BASE_URL
              ? `PLAYWRIGHT_TEST=true ${securityGateEnv} PORT=${new URL(baseURL).port || "3000"} pnpm dev`
              : `PLAYWRIGHT_TEST=true ${securityGateEnv} pnpm dev`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: process.env.CI && !isTargetedSelfheal ? 60_000 : 120_000,
      }
    : undefined,
});
