import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3171";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "tests/visual-regression.spec.ts",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "deep",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "PLAYWRIGHT_TEST=true SECURITY_DISABLE_RATE_LIMIT=true SECURITY_STUB_TURNSTILE=true PORT=3171 pnpm dev",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
