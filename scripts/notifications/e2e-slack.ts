import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  renderAgentNotification,
  sendSlackDigest,
  type AdapterDependencies,
  type AgentNotification,
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

function e2eNotification(input: E2ESlackNotification): AgentNotification {
  const summary = `${input.passed} passed, ${input.failed} failed, ${input.skipped} skipped`;
  return {
    agent: "E2E",
    details: [
      `• Source phase: ${input.phase}`,
      `• Auto-merge ${input.autoMergeEnabled ? "enabled" : "not enabled"}`,
    ],
    managerAction:
      input.phase === "green"
        ? "None"
        : input.failed > 0
          ? "Investigate the failed E2E checks"
          : "None",
    status:
      input.failed > 0
        ? "needs_attention"
        : input.status === "success"
          ? "success"
          : "failed",
    summary: [`• ${summary}`],
    workDone: input.prUrl
      ? [`• Repair PR: <${input.prUrl}|Open PR>`]
      : ["• No repair PR"],
    workflowUrl: input.workflowUrl,
  };
}

export function renderE2ESlackNotification(
  input: E2ESlackNotification,
): string {
  return renderAgentNotification(e2eNotification(input));
}

export async function sendE2ESlackNotification(
  input: E2ESlackNotification,
  dependencies: E2ESlackDependencies,
): Promise<number> {
  const report: SlackReport = { notification: e2eNotification(input) };
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
