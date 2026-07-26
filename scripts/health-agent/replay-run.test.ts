import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function collector(
  routine: "directory-health" | "link-checker" | "sentry-triage",
) {
  return {
    collectedAt: "2026-07-26T00:00:00.000Z",
    evidence: {},
    failures: [],
    findings: [],
    routine,
    skippedActions: [],
    status: "success",
    version: 1,
  };
}

describe("local health artifact replay", () => {
  it("preserves a successful Analyze phase and overall verdict", async () => {
    const artifactRoot = await mkdtemp(
      path.join(tmpdir(), "formoria-health-replay-test-"),
    );
    temporaryDirectories.push(artifactRoot);
    await Promise.all([
      writeFile(
        path.join(artifactRoot, "link-checker.json"),
        JSON.stringify(collector("link-checker")),
      ),
      writeFile(
        path.join(artifactRoot, "directory-health.json"),
        JSON.stringify(collector("directory-health")),
      ),
      writeFile(
        path.join(artifactRoot, "sentry-triage.json"),
        JSON.stringify(collector("sentry-triage")),
      ),
      writeFile(
        path.join(artifactRoot, "sentry-issues.json"),
        JSON.stringify({ issues: [] }),
      ),
    ]);

    const { stdout } = await execFileAsync(
      "bash",
      ["scripts/health-agent/replay-run.sh", "987654321", artifactRoot],
      { cwd: process.cwd(), maxBuffer: 1_000_000 },
    );
    const replay = JSON.parse(stdout) as {
      envelope: { data: { phases: { analyze: string } }; status: string };
    };

    expect(replay.envelope.data.phases.analyze).toBe("success");
    expect(replay.envelope.status).toBe("success");
  }, 20_000);
});
