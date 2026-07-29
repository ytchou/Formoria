import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // Vitest defaults to 5000ms, which several tests exceed under full-suite
    // parallel load but never in isolation — jsdom + userEvent interactions and
    // the next/dynamic module imports behind the lazily-loaded dialogs are the
    // slow paths. A too-small budget turns worker contention into false failures
    // that look like real regressions.
    testTimeout: 15_000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts", "supabase/functions/**/*.test.ts"],
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
  },
  resolve: {
    alias: {
      "@emails": path.resolve(__dirname, "./emails"),
      "@": path.resolve(__dirname, "./src"),
      "next/server": path.resolve(__dirname, "./node_modules/next/server.js"),
      "next/navigation": path.resolve(
        __dirname,
        "./node_modules/next/navigation.js"
      ),
      "next/headers": path.resolve(__dirname, "./node_modules/next/headers.js"),
    },
  },
});
