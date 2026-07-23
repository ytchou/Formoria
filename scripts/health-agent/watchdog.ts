import { pathToFileURL } from "node:url";

import { sendSlackDigest } from "./adapters";

const TARGET_WORKFLOW = "health-agent.yml";
const AGGREGATE_JOB = "aggregate-and-deliver";
const DELIVERY_STEP = "Deliver Agent Hub envelopes";
const TAIPEI_TIME_ZONE = "Asia/Taipei";
const LOGICAL_START_MINUTES = 7 * 60;
const LOGICAL_END_MINUTES = 8 * 60 + 30;

export interface GitHubWorkflowRun {
  conclusion: string | null;
  created_at: string;
  html_url?: string;
  id: number;
  run_attempt?: number;
  run_started_at?: string | null;
  status: string;
}

export interface GitHubWorkflowStep {
  conclusion: string | null;
  name: string;
  status: string;
}

export interface GitHubWorkflowJob {
  conclusion: string | null;
  name: string;
  status: string;
  steps?: readonly GitHubWorkflowStep[];
}

export type WatchdogFailureReason =
  | "aggregate_job_missing"
  | "aggregate_job_not_successful"
  | "delivery_not_successful"
  | "delivery_step_missing"
  | "missing_run"
  | "run_cancelled"
  | "run_failed"
  | "run_not_successful"
  | "run_timed_out";

export type FreshnessResult =
  | {
      healthy: true;
      logicalDate: string;
      run: GitHubWorkflowRun;
    }
  | {
      healthy: false;
      logicalDate: string;
      reason: WatchdogFailureReason;
      run?: GitHubWorkflowRun;
    };

interface TaipeiParts {
  date: string;
  minutes: number;
}

interface DeliveryDependencies {
  agentHub: (envelope: WatchdogFailureEnvelope) => Promise<unknown>;
  slack: (message: string) => Promise<unknown>;
}

export interface WatchdogFailureEnvelope {
  data: {
    notification_owner: "github_actions";
    reason: WatchdogFailureReason;
    target_workflow: typeof TARGET_WORKFLOW;
    workflow_run_id: number | null;
  };
  date: string;
  log_url?: string;
  project: "formoria";
  routine: "health-watchdog";
  run_at: string;
  source: "github_actions";
  source_run_id: string;
  status: "failed";
  tickets_created: [];
  verdict_severity: "critical";
  verdict_text: string;
  version: 1;
}

export interface DeliveryResult {
  agentHub: "failed" | "sent";
  slack: "failed" | "sent";
}

function taipeiParts(value: string | Date): TaipeiParts | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  if (!year || !month || !day || !Number.isFinite(hour + minute)) return null;
  return {
    date: `${year}-${month}-${day}`,
    minutes: hour * 60 + minute,
  };
}

function runTimestamp(run: GitHubWorkflowRun): string {
  return run.run_started_at || run.created_at;
}

export function selectLogicalRun(
  runs: readonly GitHubWorkflowRun[],
  now: Date,
): GitHubWorkflowRun | undefined {
  const target = taipeiParts(now);
  if (!target) throw new Error("Watchdog clock is invalid");

  return runs
    .filter((run) => {
      const started = taipeiParts(runTimestamp(run));
      const timestamp = Date.parse(runTimestamp(run));
      return (
        started?.date === target.date &&
        started.minutes >= LOGICAL_START_MINUTES &&
        started.minutes < LOGICAL_END_MINUTES &&
        Number.isFinite(timestamp) &&
        timestamp <= now.getTime()
      );
    })
    .sort(
      (left, right) =>
        Date.parse(runTimestamp(right)) - Date.parse(runTimestamp(left)),
    )[0];
}

function failedRunReason(run: GitHubWorkflowRun): WatchdogFailureReason | null {
  if (run.conclusion === "cancelled") return "run_cancelled";
  if (run.conclusion === "timed_out") return "run_timed_out";
  if (run.conclusion === "failure") return "run_failed";
  if (run.status === "completed" && run.conclusion !== "success") {
    return "run_not_successful";
  }
  return null;
}

export function evaluateHealthFreshness({
  jobs,
  now,
  runs,
}: {
  jobs: readonly GitHubWorkflowJob[];
  now: Date;
  runs: readonly GitHubWorkflowRun[];
}): FreshnessResult {
  const logicalDate = taipeiParts(now)?.date;
  if (!logicalDate) throw new Error("Watchdog clock is invalid");
  const run = selectLogicalRun(runs, now);
  if (!run) return { healthy: false, logicalDate, reason: "missing_run" };

  const runFailure = failedRunReason(run);
  if (runFailure) {
    return { healthy: false, logicalDate, reason: runFailure, run };
  }

  const aggregate = jobs.find((job) => job.name === AGGREGATE_JOB);
  if (!aggregate) {
    return {
      healthy: false,
      logicalDate,
      reason: "aggregate_job_missing",
      run,
    };
  }
  const delivery = aggregate.steps?.find((step) => step.name === DELIVERY_STEP);
  if (!delivery) {
    return {
      healthy: false,
      logicalDate,
      reason: "delivery_step_missing",
      run,
    };
  }
  if (delivery.status !== "completed" || delivery.conclusion !== "success") {
    return {
      healthy: false,
      logicalDate,
      reason: "delivery_not_successful",
      run,
    };
  }

  if (aggregate.status !== "completed" || aggregate.conclusion !== "success") {
    return {
      healthy: false,
      logicalDate,
      reason: "aggregate_job_not_successful",
      run,
    };
  }

  return { healthy: true, logicalDate, run };
}

export function createWatchdogFailureEnvelope({
  now,
  result,
  sourceRunId,
  workflowUrl,
}: {
  now: Date;
  result: Extract<FreshnessResult, { healthy: false }>;
  sourceRunId: string;
  workflowUrl?: string;
}): WatchdogFailureEnvelope {
  const verdict = `Health watchdog failed: ${result.reason} for ${result.logicalDate}.`;
  return {
    data: {
      notification_owner: "github_actions",
      reason: result.reason,
      target_workflow: TARGET_WORKFLOW,
      workflow_run_id: result.run?.id ?? null,
    },
    date: result.logicalDate,
    ...(workflowUrl ? { log_url: workflowUrl } : {}),
    project: "formoria",
    routine: "health-watchdog",
    run_at: now.toISOString(),
    source: "github_actions",
    source_run_id: sourceRunId,
    status: "failed",
    tickets_created: [],
    verdict_severity: "critical",
    verdict_text: verdict,
    version: 1,
  };
}

export async function deliverWatchdogFailure(
  envelope: WatchdogFailureEnvelope,
  dependencies: DeliveryDependencies,
): Promise<DeliveryResult> {
  const message = `${envelope.verdict_text} ${envelope.log_url ?? ""}`.trim();
  const [slack, agentHub] = await Promise.allSettled([
    Promise.resolve().then(() => dependencies.slack(message)),
    Promise.resolve().then(() => dependencies.agentHub(envelope)),
  ]);
  return {
    agentHub: agentHub.status === "fulfilled" ? "sent" : "failed",
    slack: slack.status === "fulfilled" ? "sent" : "failed",
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function githubJson(path: string, token: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub watchdog read failed with status ${response.status}`,
    );
  }
  return response.json();
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function inspectHealthWorkflow(
  repository: string,
  token: string,
  now: Date,
): Promise<FreshnessResult> {
  const runsResponse = record(
    await githubJson(
      `/repos/${repository}/actions/workflows/${TARGET_WORKFLOW}/runs?per_page=30`,
      token,
    ),
  );
  const runs = Array.isArray(runsResponse?.workflow_runs)
    ? (runsResponse.workflow_runs as GitHubWorkflowRun[])
    : [];
  const run = selectLogicalRun(runs, now);
  if (!run) return evaluateHealthFreshness({ jobs: [], now, runs });
  const jobsResponse = record(
    await githubJson(
      `/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
      token,
    ),
  );
  const jobs = Array.isArray(jobsResponse?.jobs)
    ? (jobsResponse.jobs as GitHubWorkflowJob[])
    : [];
  return evaluateHealthFreshness({ jobs, now, runs });
}

export async function main(): Promise<void> {
  const repository = requiredEnvironment("GITHUB_REPOSITORY");
  const githubToken = requiredEnvironment("GITHUB_TOKEN");
  const now = new Date();
  const result = await inspectHealthWorkflow(repository, githubToken, now);
  if (result.healthy) {
    console.log(
      JSON.stringify({
        event: "health_watchdog_healthy",
        logical_date: result.logicalDate,
        workflow_run_id: result.run.id,
      }),
    );
    return;
  }

  const workflowUrl = requiredEnvironment("WATCHDOG_WORKFLOW_URL");
  const sourceRunId = `github-actions:health-watchdog:${requiredEnvironment("GITHUB_RUN_ID")}:${requiredEnvironment("GITHUB_RUN_ATTEMPT")}`;
  const envelope = createWatchdogFailureEnvelope({
    now,
    result,
    sourceRunId,
    workflowUrl,
  });
  const reportModule = await import("../agent-hub/report-run.mjs");
  const delivery = await deliverWatchdogFailure(envelope, {
    agentHub: (value) => reportModule.reportAgentRun(value),
    slack: (message) =>
      sendSlackDigest(
        { failures: [message] },
        {
          audit: (auditRecord) =>
            console.log(
              JSON.stringify({
                event: "health_watchdog_slack_audit",
                ...auditRecord,
              }),
            ),
          webhookUrl: requiredEnvironment("SLACK_HEALTH_WEBHOOK_URL"),
        },
      ),
  });
  console.log(
    JSON.stringify({
      delivery,
      event: "health_watchdog_failed",
      logical_date: result.logicalDate,
      reason: result.reason,
      workflow_run_id: result.run?.id ?? null,
    }),
  );
  throw new Error(`Health watchdog detected ${result.reason}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({ event: "health_watchdog_execution_failed", message }),
    );
    process.exitCode = 1;
  });
}
