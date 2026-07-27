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

const collector = { findings: [], status: "success" };

describe("local health run replay", () => {
  it("reconstructs a report from the one run artifact without invoking collectors", async () => {
    const artifactRoot = await mkdtemp(
      path.join(tmpdir(), "formoria-health-replay-test-"),
    );
    temporaryDirectories.push(artifactRoot);
    await writeFile(
      path.join(artifactRoot, "health-run.json"),
      JSON.stringify({
        canonicalFindings: [],
        groups: {
          product: { directory: collector, link: collector, status: "success" },
          repository: collector,
          runtime: collector,
        },
        lifecycle: { new: 0, ongoing: 0, regressed: 0 },
        managerReport: { envelope: { status: "success" } },
        repair: null,
      }),
    );

    const { stdout } = await execFileAsync(
      "bash",
      [
        "scripts/health-agent/replay-run.sh",
        "987654321",
        artifactRoot,
        "report",
      ],
      { cwd: process.cwd(), maxBuffer: 1_000_000 },
    );
    const replay = JSON.parse(stdout) as {
      managerReport: { envelope: { status: string } };
      sourceRunId: string;
    };

    expect(replay).toEqual({
      managerReport: { envelope: { status: "success" } },
      sourceRunId: "987654321",
    });
  });
});
