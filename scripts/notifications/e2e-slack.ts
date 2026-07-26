import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  renderAgentNotification,
  sendSlackDigest,
  type AdapterDependencies,
  type AgentNotification,
  type SlackReport,
} from "../health-agent/adapters";

export type E2ESlackPhase = "blocked" | "initial" | "ready";

export interface E2ESlackNotification {
  failed: number;
  passed: number;
  phase: E2ESlackPhase;
  prUrl?: string;
  reason?: string;
  runAttempt: string;
  runId: string;
  selfHealEnabled?: boolean;
  skipped: number;
  status: string;
  workflowUrl: string;
}

export interface E2ESlackDependencies extends AdapterDependencies {
  webhookUrl: string;
}

function e2eNotification(input: E2ESlackNotification): AgentNotification {
  const summary = `• ${input.passed} passed · ${input.failed} failed · ${input.skipped} skipped`;
  if (input.phase === "ready") {
    return {
      agent: "E2E",
      details: [
        "• Self-heal validation is green",
        "• Automatic merge is disabled",
      ],
      managerAction: "Review and merge the repair PR",
      status: "success",
      summary: [summary],
      workDone: [`• Repair PR: <${input.prUrl ?? input.workflowUrl}|Open PR>`],
      workflowUrl: input.workflowUrl,
    };
  }

  if (input.phase === "blocked") {
    return {
      agent: "E2E",
      details: [
        `• Reason: ${input.reason ?? "the repair process could not continue"}`,
      ],
      managerAction: "Investigate why self-heal stopped",
      status: "failed",
      summary: [summary],
      workDone: ["• No repair PR created"],
      workflowUrl: input.workflowUrl,
    };
  }

  const succeeded = input.status === "success";
  const selfHealEnabled = input.selfHealEnabled === true;
  return {
    agent: "E2E",
    details: [
      succeeded
        ? "• No failures detected"
        : selfHealEnabled
          ? "• Self-heal is enabled and will run after guard checks"
          : "• Self-heal is disabled",
    ],
    managerAction: succeeded
      ? "None"
      : selfHealEnabled
        ? "Monitor self-heal; investigate if no repair run starts"
        : "Investigate the failed E2E checks",
    status: succeeded ? "success" : "needs_attention",
    summary: [summary],
    workDone: [
      succeeded
        ? "• No repair needed"
        : selfHealEnabled
          ? "• Automated repair requested"
          : "• No automated repair started",
    ],
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

export interface PlaywrightStats {
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

export function e2eSlackWebhookUrl(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = environment.SLACK_FORMORIA_WEBHOOK_URL;
  if (!value) throw new Error("SLACK_FORMORIA_WEBHOOK_URL is required");
  return value;
}

export function playwrightStatsFromEnvironment(
  stats: PlaywrightStats,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PlaywrightStats {
  return {
    failed: Number(environment.E2E_FAILED ?? stats.failed),
    passed: Number(environment.E2E_PASSED ?? stats.passed),
    skipped: Number(environment.E2E_SKIPPED ?? stats.skipped),
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const phase = requiredEnvironment("E2E_SLACK_PHASE");
  if (phase !== "initial" && phase !== "ready" && phase !== "blocked") {
    throw new Error(`Unsupported E2E Slack phase: ${phase}`);
  }
  const stats = await readPlaywrightStats(
    phase === "initial"
      ? "playwright-results.json"
      : "playwright-results-validation.json",
  );
  const reportedStats = playwrightStatsFromEnvironment(stats);
  await sendE2ESlackNotification(
    {
      ...reportedStats,
      phase,
      prUrl: process.env.PR_URL,
      reason: process.env.BLOCKED_REASON,
      runAttempt: requiredEnvironment("GITHUB_RUN_ATTEMPT"),
      runId: requiredEnvironment("GITHUB_RUN_ID"),
      selfHealEnabled: process.env.SELFHEAL_ENABLED === "true",
      status: process.env.JOB_STATUS ?? "unknown",
      workflowUrl: requiredEnvironment("WORKFLOW_URL"),
    },
    {
      audit: (record) =>
        console.log(
          JSON.stringify({ event: "e2e_nightly_slack_audit", ...record }),
        ),
      webhookUrl: e2eSlackWebhookUrl(),
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
