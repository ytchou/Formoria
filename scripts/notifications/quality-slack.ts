import { pathToFileURL } from "node:url";

import {
  renderAgentNotification,
  sendSlackDigest,
  type AdapterDependencies,
  type AgentNotification,
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

function qualityNotification(
  input: QualitySlackNotification,
): AgentNotification {
  const unitCoverageStatus =
    input.unitCoverageResult === "success" ? "passed" : "FAILED";
  const deadCodeStatus =
    input.deadCodeResult === "success" ? "passed" : "FAILED";
  const allClear =
    input.unitCoverageResult === "success" &&
    input.deadCodeResult === "success";
  return {
    agent: "Quality",
    details: [
      `• Source phase: ${input.phase}`,
      `• Auto-merge ${input.autoMergeEnabled ? "enabled" : "not enabled"}`,
    ],
    managerAction: allClear ? "None" : "Investigate the failed quality checks",
    status: allClear ? "success" : "needs_attention",
    summary: [
      `• Unit coverage: ${unitCoverageStatus} · Dead code: ${deadCodeStatus}`,
    ],
    workDone: input.prUrl
      ? [`• Repair PR: <${input.prUrl}|Open PR>`]
      : ["• No repair PR"],
    workflowUrl: input.workflowUrl,
  };
}

export function renderQualitySlackNotification(
  input: QualitySlackNotification,
): string {
  return renderAgentNotification(qualityNotification(input));
}

export async function sendQualitySlackNotification(
  input: QualitySlackNotification,
  dependencies: QualitySlackDependencies,
): Promise<number> {
  const report: SlackReport = { notification: qualityNotification(input) };
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
