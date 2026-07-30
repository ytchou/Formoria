import { defineConfig, devices } from '@playwright/test';

// Load .env.local so global-setup can access env vars outside the Next.js runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: '.env.local' });

// Disable dev-only widgets (e.g., Agentation) during test runs
process.env.PLAYWRIGHT_TEST = 'true';

const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
const isLocalTarget = ['localhost', '127.0.0.1', '::1'].includes(new URL(baseURL).hostname);

// Ensure the E2E admin account is in ADMIN_EMAILS so isAdmin() passes during tests
if (process.env.E2E_ADMIN_EMAIL && process.env.ADMIN_EMAILS) {
  const emails = process.env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase());
  const e2eAdmin = process.env.E2E_ADMIN_EMAIL.trim().toLowerCase();
  if (!emails.includes(e2eAdmin)) {
    process.env.ADMIN_EMAILS = `${process.env.ADMIN_EMAILS},${process.env.E2E_ADMIN_EMAIL}`;
  }
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // ubuntu-latest has 4 vCPU. Five spec files set `describe.configure({ mode:
  // 'serial' })` and pin to a single worker regardless (they carry ownership
  // constraints — see dashboard-brand-owned-edit.spec.ts), so raising this
  // caps out well below 4x.
  //
  // Locally, Playwright would default to half the cores. Against `pnpm dev` that
  // oversubscribes one Turbopack process: pages get torn down with RSC fetches
  // still in flight, and the aborted response (ECONNRESET server-side) reaches
  // the client as a truncated flight payload, so `JSON.parse` throws and the dev
  // error overlay replaces the page under test. Cap it — the suite is bound by
  // the dev server, not by CPU.
  workers: process.env.CI ? 4 : 3,
  reporter: 'html',
  // CI serves a production build via `pnpm start`, so every route is already
  // compiled and 30s is a real budget. Locally `webServer` runs `pnpm dev`,
  // which compiles each route on demand while parallel workers race the same
  // cold compile — that alone can push a first `page.goto` past 30s. Keep CI
  // strict so a genuine regression still fails there.
  timeout: process.env.CI ? 30_000 : 60_000,
  use: {
    baseURL,
    // Not 'on-first-retry': with retries=1 a fail-then-pass keeps only the
    // passing attempt's trace, which is how flakes became unfixable after
    // the fact. Retain the attempt that actually failed.
    trace: 'retain-on-failure',
    locale: 'zh-TW',
  },
  projects: [
    // Smoke: all browsers
    {
      name: 'smoke-chromium',
      testMatch: 'e2e/smoke/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'smoke-firefox',
      testMatch: 'e2e/smoke/**/*.spec.ts',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'smoke-webkit',
      testMatch: 'e2e/smoke/**/*.spec.ts',
      timeout: 60_000,
      use: { ...devices['Desktop Safari'], navigationTimeout: 45_000 },
    },
    // Deep: Chrome only
    {
      name: 'deep',
      testMatch: 'e2e/tests/**/*.spec.ts',
      testIgnore: 'e2e/tests/mobile.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile: Chrome
    {
      name: 'mobile',
      testMatch: 'e2e/tests/mobile.spec.ts',
      use: { ...devices['Pixel 5'] },
    },
  ],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // A remote BASE_URL means synthetic monitoring against an already-deployed
  // origin — there is nothing to boot locally, and booting anyway either
  // computes an empty PORT (https URLs carry no port) or wastes a CI build.
  webServer: isLocalTarget ? {
    // PLAYWRIGHT_TEST=true must be on EVERY branch, not just CI. `proxy.ts`
    // skips the soft rate limiter only when the server sees it, and
    // SOFT_LIMIT_PREFIXES is ['/brands/'] keyed by client IP — every local
    // worker shares 127.0.0.1, so the deep suite trips the limit partway
    // through and Next rewrites the rest of its /brands/* requests to
    // /challenge. Specs then poll a "快速驗證" interstitial until they time out,
    // and which specs get hit shifts run to run. Setting it in this file's
    // process is not enough to reach the dev server's proxy runtime.
    command: process.env.CI
      ? 'PLAYWRIGHT_TEST=true pnpm start'
      : process.env.BASE_URL
        ? `PLAYWRIGHT_TEST=true PORT=${new URL(baseURL).port || '3000'} pnpm dev`
        : 'PLAYWRIGHT_TEST=true pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 60_000 : 120_000,
  } : undefined,
});
