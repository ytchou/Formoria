import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  writeRedactedJson,
  type HealthCollectorArtifact,
} from "./orchestrator";
import { evaluateQualityReports } from "./quality";

const execFileAsync = promisify(execFile);

interface CommandOutcome {
  exitCode: number | null;
  stdout: string;
}

async function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandOutcome> {
  try {
    const result = await execFileAsync(command, [...args], {
      cwd,
      encoding: "utf8",
      env,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 20 * 60 * 1000,
    });
    return { exitCode: 0, stdout: result.stdout };
  } catch (error) {
    if (typeof error !== "object" || error === null) {
      return { exitCode: null, stdout: "" };
    }
    const candidate = error as { code?: unknown; stdout?: unknown };
    return {
      exitCode: typeof candidate.code === "number" ? candidate.code : null,
      stdout: typeof candidate.stdout === "string" ? candidate.stdout : "",
    };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function collectQualityArtifact({
  outputPath,
  repoRoot = process.cwd(),
  runAt = new Date().toISOString(),
}: {
  outputPath: string;
  repoRoot?: string;
  runAt?: string;
}): Promise<HealthCollectorArtifact> {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "formoria-health-quality-"),
  );
  const vitestOutput = path.join(temporaryDirectory, "vitest.json");
  try {
    const [tracked, vitest, knip] = await Promise.all([
      runCommand("git", ["ls-files", "-z"], repoRoot),
      runCommand(
        "pnpm",
        ["test", "--reporter=json", `--outputFile=${vitestOutput}`],
        repoRoot,
      ),
      runCommand("pnpm", ["--silent", "knip", "--reporter", "json"], repoRoot, {
        ...process.env,
        DOTENV_CONFIG_QUIET: "true",
      }),
    ]);
    const vitestText = await readFile(vitestOutput, "utf8").catch(() => "");
    const trackedFiles = new Set(
      tracked.stdout.split("\0").filter((file) => file.length > 0),
    );
    const result = evaluateQualityReports({
      knipExitCode: knip.exitCode ?? -1,
      knipReport: parseJson(knip.stdout),
      repoRoot,
      trackedFiles,
      vitestExitCode: vitest.exitCode ?? -1,
      vitestReport: parseJson(vitestText),
    });
    const commandFailures = [
      ...(tracked.exitCode === 0 ? [] : ["git-ls-files:command_failed"]),
      ...(vitest.exitCode === null ? ["full-unit-suite:command_failed"] : []),
      ...(knip.exitCode === null ? ["dead-code:command_failed"] : []),
    ];
    const failures = [...commandFailures, ...result.failures];
    const artifact: HealthCollectorArtifact = {
      collectedAt: runAt,
      evidence: {
        commands: {
          deadCode:
            "DOTENV_CONFIG_QUIET=true pnpm --silent knip --reporter json",
          fullUnitSuite:
            "pnpm test --reporter=json --outputFile=<temporary-file>",
        },
        summary: result.summary,
      },
      ...(failures[0] ? { failure: failures[0] } : {}),
      failures,
      findings: result.findings,
      routine: "quality-health",
      skippedActions: [],
      snapshot: {
        deadCode: result.summary.deadCode,
        fullUnitSuite: result.summary.fullUnitSuite,
      },
      status: failures.length > 0 ? "failed" : "success",
      version: 1,
    };
    await writeRedactedJson(outputPath, artifact);
    return artifact;
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const outputPath = argument("--output");
  if (!outputPath) throw new Error("--output is required");
  await collectQualityArtifact({
    outputPath,
    repoRoot: argument("--repo-root") ?? process.cwd(),
    runAt: argument("--run-at") ?? new Date().toISOString(),
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : "quality_health_failed",
        event: "quality_health_failed",
      }),
    );
    process.exitCode = 1;
  });
}
