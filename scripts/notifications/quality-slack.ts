import { pathToFileURL } from "node:url";

import {
  sendSlackDigest,
  type AdapterDependencies,
  type SlackReport,
} from "../health-agent/adapters";

export type QualitySlackPhase = "initial" | "green";

export interface QualitySlackNotification {
  autoMergeEnabled?: boolean;
  deadCodeResult: string;
  phase: QualitySlackPhase;
  prUrl?: string;
  runAttempt: string;
  runId: string;
  unitCoverageResult: string;
  workflowUrl: string;
}

export interface QualitySlackDependencies extends AdapterDependencies {
  webhookUrl: string;
}

export function renderQualitySlackNotification(
  input: QualitySlackNotification,
): string {
  if (input.phase === "green") {
    return [
      "Self-heal green",
      `PR: ${input.prUrl ?? "not available"}`,
      `Auto-merge ${input.autoMergeEnabled ? "enabled" : "not enabled"}`,
      `Workflow: ${input.workflowUrl}`,
    ].join("\n");
  }

  const unitCoverageStatus =
    input.unitCoverageResult === "success" ? "passed" : "FAILED";
  const deadCodeStatus =
    input.deadCodeResult === "success" ? "passed" : "FAILED";
  const allClear =
    input.unitCoverageResult === "success" &&
    input.deadCodeResult === "success";

  return [
    allClear ? "Quality nightly — all clear" : "Quality nightly",
    `unit-coverage: ${unitCoverageStatus}`,
    `dead-code: ${deadCodeStatus}`,
    ...(!allClear ? [`Workflow: ${input.workflowUrl}`] : []),
  ].join("\n");
}

export async function sendQualitySlackNotification(
  input: QualitySlackNotification,
  dependencies: QualitySlackDependencies,
): Promise<number> {
  const message = renderQualitySlackNotification(input);
  const allClear =
    input.unitCoverageResult === "success" &&
    input.deadCodeResult === "success";
  const report: SlackReport =
    input.phase === "green"
      ? { pullRequests: [message] }
      : allClear
        ? { skipped: [message] }
        : { failures: [message] };
  return sendSlackDigest(report, dependencies);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const phase = requiredEnvironment("QUALITY_SLACK_PHASE");
  if (phase !== "initial" && phase !== "green") {
    throw new Error(`Unsupported Quality Slack phase: ${phase}`);
  }
  await sendQualitySlackNotification(
    {
      autoMergeEnabled: process.env.AUTO_MERGE_ENABLED === "true",
      deadCodeResult: requiredEnvironment("DEAD_CODE_RESULT"),
      phase,
      prUrl: process.env.PR_URL,
      runAttempt: requiredEnvironment("GITHUB_RUN_ATTEMPT"),
      runId: requiredEnvironment("GITHUB_RUN_ID"),
      unitCoverageResult: requiredEnvironment("UNIT_COVERAGE_RESULT"),
      workflowUrl: requiredEnvironment("WORKFLOW_URL"),
    },
    {
      audit: (record) =>
        console.log(
          JSON.stringify({ event: "quality_nightly_slack_audit", ...record }),
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
