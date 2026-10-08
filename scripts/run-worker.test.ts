import { spawn } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const WRAPPER = resolve(__dirname, "run-worker.sh");

// A worker stand-in: announces readiness, then exits 0 on SIGTERM the way
// src/editorial-producer/server.ts does after worker.stop().
const CHILD = `
process.on("SIGTERM", () => { console.log("got-term"); process.exit(0); });
console.log("ready");
setInterval(() => {}, 1000);
`;

let dir = "";

function sandbox(pkg: Record<string, unknown>): string {
  dir = mkdtempSync(join(tmpdir(), "run-worker-"));
  copyFileSync(WRAPPER, join(dir, "run-worker.sh"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  writeFileSync(join(dir, "child.cjs"), CHILD);
  return dir;
}

function runUntilTerm(
  cwd: string,
): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const proc = spawn("bash", ["run-worker.sh", "node", "child.cjs"], { cwd });
    let out = "";
    const kill = setTimeout(() => proc.kill("SIGKILL"), 4000);
    proc.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      // Railway stops the container by signalling the wrapper (via pnpm).
      if (out.includes("ready") && !out.includes("sent")) {
        out += "sent";
        proc.kill("SIGTERM");
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(kill);
      done({ code, out });
    });
  });
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("run-worker.sh", () => {
  it("delivers SIGTERM to the worker in the container (type: module) path", async () => {
    const cwd = sandbox({ name: "x", type: "module" });
    const { code, out } = await runUntilTerm(cwd);
    expect(out).toContain("got-term");
    expect(code).toBe(0);
  });

  it("restores package.json after a local run that injected type: module", async () => {
    const cwd = sandbox({ name: "x" });
    const before = readFileSync(join(cwd, "package.json"), "utf8");
    await new Promise<void>((done) => {
      spawn("bash", ["run-worker.sh", "node", "-e", "0"], { cwd }).on(
        "exit",
        () => done(),
      );
    });
    expect(readFileSync(join(cwd, "package.json"), "utf8")).toBe(before);
  });
});
