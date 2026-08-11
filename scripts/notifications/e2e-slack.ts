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

export interface E2EFailedSpec {
  file?: string | null;
  project?: string;
  title: string;
}

const TAIPEI_TIME_ZONE = "Asia/Taipei";

/**
 * `YYYY-MM-DD` in Asia/Taipei — the same basis as the Agent Hub report date
 * (`TZ=Asia/Taipei date +%F` in the workflows). UTC would be wrong for the
 * nightly, which starts 22:10 UTC and so belongs to the *following* Taipei day.
 */
export function taipeiRunDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
  }).format(now);
}

export interface E2ESlackNotification {
  // Defaults to today in Asia/Taipei. Overridable so a caller can pass the
  // run's own start time rather than the moment the notification is sent.
  date?: string;
  failed: number;
  failedSpecs?: readonly (E2EFailedSpec | string)[];
  // Distinguishes the two monitors in Slack. The nightly deep suite and the
  // production synthetic probe both render "Formoria E2E — Success", which made
  // them indistinguishable at a glance. Defaults to "E2E" so any caller that
  // does not set it keeps the original title.
  label?: string;
  passed: number;
  phase: E2ESlackPhase;
  prUrl?: string;
  reportAvailable?: boolean;
  reason?: string;
  runAttempt: string;
  runId: string;
  // One line on what this run actually covers. Counts alone do not say whether
  // 4 passing specs are the whole story or a deliberate slice.
  scope?: string;
  selfHealEnabled?: boolean;
  skipped: number;
  status: string;
  // What was probed — a deployed origin for the synthetic monitor, omitted for
  // the nightly suite, which tests a server it builds itself.
  target?: string;
  workflowUrl: string;
}

export interface E2ESlackDependencies extends AdapterDependencies {
  webhookUrl: string;
}

function formatFailedSpec(spec: E2EFailedSpec | string): string {
  if (typeof spec === "string") return `• ${spec}`;
  const title = spec.title.trim();
  const file = spec.file?.trim();
  return `• ${file ? `${file} — ` : ""}${title}`;
}

function e2eNotification(input: E2ESlackNotification): AgentNotification {
  const agent = input.label?.trim() || "E2E";
  const date = input.date?.trim() || taipeiRunDate();
  const failedSpecs = (input.failedSpecs ?? [])
    .map(formatFailedSpec)
    .filter((spec) => spec !== "• ");
  const remainingFailedSpecs =
    failedSpecs.length > 0 ? failedSpecs.length : input.failed;
  const counts =
    input.reportAvailable === false
      ? remainingFailedSpecs > 0
        ? `• ${remainingFailedSpecs} remaining failed specs`
        : "• Remaining failed specs unavailable"
      : `• ${input.passed} passed · ${input.failed} failed · ${input.skipped} skipped`;
  const scope = input.scope?.trim();
  const target = input.target?.trim();
  const summary = [
    ...(scope ? [`• Scope: ${scope}`] : []),
    counts,
    ...(target ? [`• Target: ${target}`] : []),
  ];
  if (input.phase === "ready") {
    return {
      agent,
      date,
      failedSpecs,
      pullRequestLabel: "Repair PR",
      pullRequestUrl: input.prUrl,
      status: "success",
      summary,
      workflowUrl: input.workflowUrl,
    };
  }

  if (input.phase === "blocked") {
    return {
      agent,
      date,
      failedSpecs,
      pullRequestLabel: "Blocked draft PR",
      pullRequestUrl: input.prUrl,
      status: "failed",
      summary,
      workflowUrl: input.workflowUrl,
    };
  }

  const succeeded = input.status === "success";
  return {
    agent,
    date,
    failedSpecs,
    status: succeeded ? "success" : "needs_attention",
    summary,
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

export interface PlaywrightReport {
  failedSpecs: E2EFailedSpec[];
  reportAvailable: boolean;
  stats: PlaywrightStats;
}

const emptyPlaywrightReport = (): PlaywrightReport => ({
  failedSpecs: [],
  reportAvailable: false,
  stats: { failed: 0, passed: 0, skipped: 0 },
});

function nonnegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectFailedSpecs(
  suites: unknown,
  inheritedFile: string | null,
  result: E2EFailedSpec[],
): void {
  if (!Array.isArray(suites)) return;
  for (const suite of suites) {
    if (!isRecord(suite)) continue;
    const file =
      typeof suite.file === "string" && suite.file.trim()
        ? suite.file.trim()
        : inheritedFile;
    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (!isRecord(spec) || spec.ok !== false) continue;
        if (typeof spec.title !== "string" || !spec.title.trim()) continue;
        const projectValue = Array.isArray(spec.tests)
          ? spec.tests.find(
              (test): test is Record<string, unknown> =>
                isRecord(test) && typeof test.projectName === "string",
            )?.projectName
          : undefined;
        const project =
          typeof projectValue === "string" ? projectValue : undefined;
        result.push({
          file,
          ...(project ? { project } : {}),
          title: spec.title.trim(),
        });
      }
    }
    collectFailedSpecs(suite.suites, file, result);
  }
}

export function parsePlaywrightReport(value: unknown): PlaywrightReport {
  if (!isRecord(value)) return emptyPlaywrightReport();
  if (!isRecord(value.stats) && !Array.isArray(value.suites)) {
    return emptyPlaywrightReport();
  }
  const stats = isRecord(value.stats) ? value.stats : {};
  const failedSpecs: E2EFailedSpec[] = [];
  collectFailedSpecs(value.suites, null, failedSpecs);
  return {
    failedSpecs,
    reportAvailable: true,
    stats: {
      failed: nonnegativeNumber(stats.unexpected),
      passed:
        nonnegativeNumber(stats.expected) + nonnegativeNumber(stats.flaky),
      skipped: nonnegativeNumber(stats.skipped),
    },
  };
}

export async function readPlaywrightReport(
  path: string,
): Promise<PlaywrightReport> {
  try {
    return parsePlaywrightReport(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return emptyPlaywrightReport();
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
  const countFromEnvironment = (name: string, fallback: number): number => {
    const value = Number(environment[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return {
    failed: countFromEnvironment("E2E_FAILED", stats.failed),
    passed: countFromEnvironment("E2E_PASSED", stats.passed),
    skipped: countFromEnvironment("E2E_SKIPPED", stats.skipped),
  };
}

export function failedSpecsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): E2EFailedSpec[] {
  const value = environment.E2E_FAILED_SPECS;
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((spec): E2EFailedSpec[] => {
      if (
        !isRecord(spec) ||
        typeof spec.title !== "string" ||
        !spec.title.trim()
      ) {
        return [];
      }
      const file =
        typeof spec.file === "string" && spec.file.trim()
          ? spec.file.trim()
          : null;
      const project =
        typeof spec.project === "string" && spec.project.trim()
          ? spec.project.trim()
          : undefined;
      return [
        {
          file,
          ...(project ? { project } : {}),
          title: spec.title.trim(),
        },
      ];
    });
  } catch {
    return [];
  }
}

export function reportAvailabilityFromEnvironment(
  fallback: boolean,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const value = environment.E2E_REPORT_AVAILABLE;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
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
  const report = await readPlaywrightReport(
    phase === "initial"
      ? "playwright-results.json"
      : "playwright-results-validation.json",
  );
  const environmentFailedSpecs = failedSpecsFromEnvironment();
  const reportedStats = playwrightStatsFromEnvironment(report.stats);
  await sendE2ESlackNotification(
    {
      ...reportedStats,
      failedSpecs:
        environmentFailedSpecs.length > 0
          ? environmentFailedSpecs
          : report.failedSpecs,
      date: process.env.E2E_SLACK_DATE,
      label: process.env.E2E_SLACK_LABEL,
      phase,
      prUrl: process.env.PR_URL,
      reportAvailable: reportAvailabilityFromEnvironment(
        report.reportAvailable,
      ),
      reason: process.env.BLOCKED_REASON,
      runAttempt: requiredEnvironment("GITHUB_RUN_ATTEMPT"),
      runId: requiredEnvironment("GITHUB_RUN_ID"),
      scope: process.env.E2E_SLACK_SCOPE,
      selfHealEnabled: process.env.SELFHEAL_ENABLED === "true",
      status: process.env.JOB_STATUS ?? "unknown",
      target: process.env.E2E_SLACK_TARGET,
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
