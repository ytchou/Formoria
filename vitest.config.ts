import { defineConfig } from "vitest/config";
import path from "path";

const include = [
  "src/**/*.test.ts",
  "src/**/*.test.tsx",
  "scripts/**/*.test.ts",
  "supabase/functions/**/*.test.ts",
  // e2e/ is excluded from tsconfig and from Playwright's own run, but the
  // wall-supply guard is pure logic and needs a live unit test (DEV-1485).
  "e2e/utils/**/*.test.ts",
  // `workers/` is excluded from tsconfig (it targets the Workers runtime, not
  // Next), but the maintenance gate is pure request logic and its bypass
  // comparison needs a live test (DEV-1551).
  "workers/**/*.test.ts",
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
        },
      },
    ],
  },
});
