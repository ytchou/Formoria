import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts", "supabase/functions/**/*.test.ts", "tina/__generated__/**/*.test.ts"],
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
