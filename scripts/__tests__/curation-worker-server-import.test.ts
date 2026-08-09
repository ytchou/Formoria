import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("curation worker startup boundary", () => {
  it("loads the plain Node worker dependency graph before it can listen", async () => {
    // Regression: the worker previously imported `server-only` through a
    // service module, so plain Node crashed before the HTTP server listened.
    const probe = [
      "./src/lib/services/curation-jobs.ts",
      "./src/lib/services/job-runner.ts",
      "./src/lib/services/curation-worker.ts",
      "./src/lib/services/job-alerts.ts",
    ]
      .map((modulePath) => `import(${JSON.stringify(modulePath)})`)
      .join(", ");

    const result = await new Promise<{
      code: string | number | null;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        process.execPath,
        [
          "--import",
          "tsx",
          "-e",
          `Promise.all([${probe}]).then(() => console.log("worker dependency graph loaded"))`,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "worker-test-key",
          },
        },
        (error, stdout, stderr) =>
          resolve({
            code: error?.code ?? 0,
            stdout,
            stderr,
          }),
      );
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("worker dependency graph loaded");
  });
});
