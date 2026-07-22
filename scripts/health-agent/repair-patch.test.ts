import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const validator = path.resolve("scripts/health-agent/validate-repair-patch.sh");
const fixtures: string[] = [];

async function fixture(
  changedFiles: string[] = ["src/cart.ts"],
): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "formoria-health-repair-"),
  );
  fixtures.push(directory);
  await execFileAsync("git", ["init", "--quiet"], { cwd: directory });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: directory,
  });
  await execFileAsync("git", ["config", "user.name", "Health Test"], {
    cwd: directory,
  });
  await mkdir(path.join(directory, "src"), { recursive: true });
  await writeFile(
    path.join(directory, "src/cart.ts"),
    "export const total = 1;\n",
  );
  await execFileAsync("git", ["add", "src/cart.ts"], { cwd: directory });
  await execFileAsync("git", ["commit", "--quiet", "-m", "baseline"], {
    cwd: directory,
  });
  await mkdir(path.join(directory, ".health-agent-artifacts"), {
    recursive: true,
  });
  await writeFile(
    path.join(directory, ".health-agent-artifacts/metadata.json"),
    `${JSON.stringify({
      automatic: {
        finding_count: 1,
        traceability: [{ changedFiles, fingerprint: "sentry:cart" }],
      },
    })}\n`,
  );
  return directory;
}

async function validate(directory: string): Promise<void> {
  await execFileAsync(
    "bash",
    [validator, ".health-agent-artifacts/metadata.json", "automatic"],
    { cwd: directory },
  );
}

describe("generic repair patch validation", () => {
  afterEach(async () => {
    await Promise.all(
      fixtures.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  it("accepts exactly the files allowed by traceability", async () => {
    const directory = await fixture();
    await writeFile(
      path.join(directory, "src/cart.ts"),
      "export const total = 2;\n",
    );

    await expect(validate(directory)).resolves.toBeUndefined();
  });

  it("accepts an allowlisted new file", async () => {
    const directory = await fixture(["src/new-cart.ts"]);
    await writeFile(
      path.join(directory, "src/new-cart.ts"),
      "export const total = 2;\n",
    );

    await expect(validate(directory)).resolves.toBeUndefined();
  });

  it("accepts an allowlisted deletion", async () => {
    const directory = await fixture();
    await rm(path.join(directory, "src/cart.ts"));

    await expect(validate(directory)).resolves.toBeUndefined();
  });

  it("accepts a rename when both paths are allowlisted", async () => {
    const directory = await fixture(["src/cart.ts", "src/renamed-cart.ts"]);
    await execFileAsync("git", ["mv", "src/cart.ts", "src/renamed-cart.ts"], {
      cwd: directory,
    });

    await expect(validate(directory)).resolves.toBeUndefined();
  });

  it("rejects an extra changed file", async () => {
    const directory = await fixture();
    await writeFile(
      path.join(directory, "src/cart.ts"),
      "export const total = 2;\n",
    );
    await writeFile(path.join(directory, "unexpected.ts"), "export {};\n");

    await expect(validate(directory)).rejects.toThrow();
  });

  it("rejects both sides of a rename unless both are allowed", async () => {
    const directory = await fixture(["src/renamed-cart.ts"]);
    await execFileAsync("git", ["mv", "src/cart.ts", "src/renamed-cart.ts"], {
      cwd: directory,
    });

    await expect(validate(directory)).rejects.toThrow();
  });

  it.each([
    "/tmp/cart.ts",
    "../cart.ts",
    "src/../cart.ts",
    "src/./cart.ts",
    "C:\\temp\\cart.ts",
    "src//cart.ts",
    "src/cart\n.ts",
  ])("rejects unsafe metadata path %j", async (unsafePath) => {
    const directory = await fixture([unsafePath]);
    await writeFile(
      path.join(directory, "src/cart.ts"),
      "export const total = 2;\n",
    );

    await expect(validate(directory)).rejects.toThrow();
  });
});
