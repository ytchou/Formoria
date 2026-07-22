import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const validator = path.resolve("scripts/health-agent/validate-canary-patch.sh");
const marker = "github-actions:987654321:1";
const fixtures: string[] = [];

async function fixture(): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "formoria-health-canary-"),
  );
  fixtures.push(directory);
  await execFileAsync("git", ["init", "--quiet"], { cwd: directory });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: directory,
  });
  await execFileAsync("git", ["config", "user.name", "Health Test"], {
    cwd: directory,
  });
  await writeFile(
    path.join(directory, "health-agent-canary.txt"),
    "baseline\n",
  );
  await execFileAsync("git", ["add", "health-agent-canary.txt"], {
    cwd: directory,
  });
  await execFileAsync("git", ["commit", "--quiet", "-m", "baseline"], {
    cwd: directory,
  });
  await writeFile(
    path.join(directory, "snapshot.json"),
    `${JSON.stringify({
      findings: [
        {
          evidence: { desiredMarker: marker },
          fingerprint: "directory:canary:github-app-pr",
        },
      ],
    })}\n`,
  );
  return directory;
}

async function validate(directory: string): Promise<void> {
  await execFileAsync("bash", [validator, "snapshot.json"], { cwd: directory });
}

describe("controlled canary patch validation", () => {
  afterEach(async () => {
    await Promise.all(
      fixtures.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  it("accepts the exact marker change", async () => {
    const directory = await fixture();
    await writeFile(path.join(directory, "health-agent-canary.txt"), marker);

    await expect(validate(directory)).resolves.toBeUndefined();
  });

  it("rejects an additional changed file", async () => {
    const directory = await fixture();
    await writeFile(path.join(directory, "health-agent-canary.txt"), marker);
    await writeFile(path.join(directory, "unexpected.ts"), "export {};\n");
    await execFileAsync("git", ["add", "--intent-to-add", "unexpected.ts"], {
      cwd: directory,
    });

    await expect(validate(directory)).rejects.toThrow();
  });

  it("rejects a renamed file or wrong marker content", async () => {
    const renamed = await fixture();
    await execFileAsync(
      "git",
      ["mv", "health-agent-canary.txt", "renamed-canary.txt"],
      { cwd: renamed },
    );
    await expect(validate(renamed)).rejects.toThrow();

    const wrongContent = await fixture();
    await writeFile(
      path.join(wrongContent, "health-agent-canary.txt"),
      "wrong marker",
    );
    await expect(validate(wrongContent)).rejects.toThrow();
  });
});
