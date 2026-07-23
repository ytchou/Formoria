import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  sendSlackDigest,
  type AdapterDependencies,
  type SlackReport,
} from "../health-agent/adapters";

export type E2ESlackPhase = "initial" | "green";

export interface E2ESlackNotification {
  autoMergeEnabled?: boolean;
  failed: number;
  passed: number;
  phase: E2ESlackPhase;
  prUrl?: string;
  runAttempt: string;
  runId: string;
  skipped: number;
  status: string;
  workflowUrl: string;
}

export interface E2ESlackDependencies extends AdapterDependencies {
  webhookUrl: string;
}

export function renderE2ESlackNotification(
  input: E2ESlackNotification,
): string {
  const summary = `${input.passed} passed, ${input.failed} failed, ${input.skipped} skipped`;
  if (input.phase === "green") {
    return [
      `Formoria E2E Self-heal green — ${summary}`,
      `PR: ${input.prUrl ?? "not available"}`,
      `Auto-merge ${input.autoMergeEnabled ? "enabled" : "not enabled"}`,
      `Workflow: ${input.workflowUrl}`,
    ].join("\n");
  }

  return [
    `Formoria E2E nightly — ${input.status}: ${summary}`,
    "Self-heal will continue from this failure if enabled.",
    `Workflow: ${input.workflowUrl}`,
  ].join("\n");
}

export async function sendE2ESlackNotification(
  input: E2ESlackNotification,
  dependencies: E2ESlackDependencies,
): Promise<number> {
  const message = renderE2ESlackNotification(input);
  const report: SlackReport =
    input.phase === "green"
      ? { pullRequests: [message] }
      : { failures: [message] };
  return sendSlackDigest(report, dependencies);
}

interface PlaywrightStats {
  failed: number;
  passed: number;
  skipped: number;
}

async function readPlaywrightStats(path: string): Promise<PlaywrightStats> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as {
      stats?: {
        expected?: number;
        flaky?: number;
        skipped?: number;
        unexpected?: number;
      };
    };
    const stats = value.stats ?? {};
    return {
      failed: stats.unexpected ?? 0,
      passed: (stats.expected ?? 0) + (stats.flaky ?? 0),
      skipped: stats.skipped ?? 0,
    };
  } catch {
    return { failed: 0, passed: 0, skipped: 0 };
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const phase = requiredEnvironment("E2E_SLACK_PHASE");
  if (phase !== "initial" && phase !== "green") {
    throw new Error(`Unsupported E2E Slack phase: ${phase}`);
  }
  const stats = await readPlaywrightStats(
    phase === "initial"
      ? "playwright-results.json"
      : "playwright-results-validation.json",
  );
  await sendE2ESlackNotification(
    {
      autoMergeEnabled: process.env.AUTO_MERGE_ENABLED === "true",
      ...stats,
      phase,
      prUrl: process.env.PR_URL,
      runAttempt: requiredEnvironment("GITHUB_RUN_ATTEMPT"),
      runId: requiredEnvironment("GITHUB_RUN_ID"),
      status: process.env.JOB_STATUS ?? "unknown",
      workflowUrl: requiredEnvironment("WORKFLOW_URL"),
    },
    {
      audit: (record) =>
        console.log(
          JSON.stringify({ event: "e2e_nightly_slack_audit", ...record }),
        ),
      webhookUrl: requiredEnvironment("SLACK_HEALTH_WEBHOOK_URL"),
    },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
