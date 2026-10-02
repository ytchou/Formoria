import { execFile } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Regression (DEV-1920): under ESM, `import * as Sentry from "@sentry/nextjs"`
// resolves to its CJS server build, whose re-exported Node API is invisible to
// cjs-module-lexer. `getClient`, `flush`, `withScope` and `captureException`
// were undefined, so the one-shot curation worker crashed in `flushAlerts`.
// Production injects `"type":"module"`; the `.mts` copy recreates that without
// touching package.json. `@sentry/*` is deliberately not mocked here.
// Under node_modules so `@sentry/*` resolves from the repo; one directory per
// run so concurrent vitest processes never delete each other's probe.
const cacheDir = path.join(process.cwd(), "node_modules", ".cache");
let probeDir = "";

const runner = `
import { captureAlert, flushAlerts } from "./sentry.mts";

const captured = captureAlert("probe", { error: new Error("x") });
const flushed = await flushAlerts(500);
console.log(JSON.stringify({ captured, flushed }));
`;

beforeAll(() => {
  mkdirSync(cacheDir, { recursive: true });
  probeDir = mkdtempSync(path.join(cacheDir, "formoria-esm-probe-"));
  // Copied verbatim: an `@/` import added to the adapter must fail here, not skip.
  copyFileSync(
    path.join(process.cwd(), "src/lib/adapters/alerting/sentry.ts"),
    path.join(probeDir, "sentry.mts"),
  );
  writeFileSync(path.join(probeDir, "run.mts"), runner);
});

afterAll(() => {
  if (probeDir) rmSync(probeDir, { recursive: true, force: true });
});

describe("sentry alerting adapter under ESM", () => {
  it("captures and flushes through the real ESM namespace", async () => {
    const result = await new Promise<{
      code: string | number | null;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        process.execPath,
        ["--import", "tsx", path.join(probeDir, "run.mts")],
        {
          cwd: process.cwd(),
          // Minimal env: no `.env.local` values (it points at production) and
          // an unroutable DSN, so nothing leaves the machine.
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: "production",
            SENTRY_DSN: "https://abc@127.0.0.1:9/1",
          },
        },
        (error, stdout, stderr) =>
          resolve({ code: error?.code ?? 0, stdout, stderr }),
      );
    });

    expect(result.stderr).not.toContain("is not a function");
    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}");
    expect(output.captured).toBe(true);
    expect(typeof output.flushed).toBe("boolean");
  }, 30_000);
});
