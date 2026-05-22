import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
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
      use: { ...devices['Desktop Safari'] },
    },
    // Deep: Chrome only
    {
      name: 'deep',
      testMatch: 'e2e/tests/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile: Chrome
    {
      name: 'mobile',
      testMatch: 'e2e/tests/mobile.spec.ts',
      use: { ...devices['Pixel 5'] },
    },
    // Perf: Chrome (Lighthouse)
    {
      name: 'perf',
      testMatch: 'e2e/perf/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  globalSetup: './e2e/global-setup.ts',
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
