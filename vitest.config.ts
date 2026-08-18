import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

/**
 * These suites all mutate the SAME global row in `app_settings`
 * (`owner_features_enabled`): one sets it true, one sets it false and asserts a
 * short-circuit, one deletes the row outright. Vitest runs test files in
 * parallel workers, so with RUN_SUPABASE_INTEGRATION_TESTS=true they interleave
 * and go red with no code defect. They are pinned to a project with
 * `fileParallelism: false` so they run one at a time — every other test file
 * keeps its parallelism.
 *
 * Add a file here only if it writes a globally shared `app_settings` key.
 */
const APP_SETTINGS_SERIAL_TESTS = [
  "src/lib/actions/viewer-context.test.ts",
  "src/lib/services/app-settings.test.ts",
  "src/lib/services/drip-processing.test.ts",
];

const include = [
  "src/**/*.test.ts",
  "src/**/*.test.tsx",
  "scripts/**/*.test.ts",
  "supabase/functions/**/*.test.ts",
  // e2e/ is excluded from tsconfig and from Playwright's own run, but the
  // wall-supply guard is pure logic and needs a live unit test (DEV-1485).
  "e2e/utils/**/*.test.ts",
];

// Inline projects do not inherit the root Vite config, so resolve aliases and
// the shared test options are spread into each project explicitly.
const resolve = {
  alias: {
    "@emails": path.resolve(__dirname, "./emails"),
    "@": path.resolve(__dirname, "./src"),
    "next/server": path.resolve(__dirname, "./node_modules/next/server.js"),
    "next/navigation": path.resolve(
      __dirname,
      "./node_modules/next/navigation.js"
    ),
    "next/headers": path.resolve(__dirname, "./node_modules/next/headers.js"),
    "server-only": path.resolve(__dirname, "./src/test/server-only.ts"),
  },
};

const sharedTestConfig = {
  environment: "node",
  // Vitest defaults to 5000ms, which several tests exceed under full-suite
  // parallel load but never in isolation — jsdom + userEvent interactions and
  // the next/dynamic module imports behind the lazily-loaded dialogs are the
  // slow paths. A too-small budget turns worker contention into false failures
  // that look like real regressions.
  testTimeout: 15_000,
  environmentOptions: {
    jsdom: {
      url: "http://localhost",
    },
  },
  setupFiles: ["./src/test/setup.ts", "./src/test/setup-dom.ts"],
  server: {
    deps: {
      inline: ["next-intl"],
    },
  },
};

export default defineConfig({
  resolve,
  test: {
    projects: [
      {
        resolve,
        test: {
          ...sharedTestConfig,
          name: "unit",
          include,
          exclude: [...configDefaults.exclude, ...APP_SETTINGS_SERIAL_TESTS],
        },
      },
      {
        resolve,
        test: {
          ...sharedTestConfig,
          name: "app-settings-serial",
          include: APP_SETTINGS_SERIAL_TESTS,
          fileParallelism: false,
        },
      },
    ],
  },
});
