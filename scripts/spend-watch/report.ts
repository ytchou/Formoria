import { pathToFileURL } from "node:url";

import {
  sendSlackDigest,
  type AgentNotification,
  type SlackReport,
} from "../health-agent/adapters";
import type { AuditLogger, AuditRecord } from "../health-agent/contracts";
import type { SpendReportV1 } from "@/lib/services/spend-report";

export type SpendWatchReport = SpendReportV1;
export type SpendWatchEnvironment = Readonly<
  Record<string, string | undefined>
>;

export interface SpendWatchDependencies {
  audit?: AuditLogger;
  clock?: () => number;
  env?: SpendWatchEnvironment;
  fetchImpl?: typeof fetch;
}

export interface SpendWatchResult {
  notification: AgentNotification;
  report?: SpendWatchReport;
  status: AgentNotification["status"];
}

class SpendWatchHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Spend report request returned HTTP ${status}`);
    this.name = "SpendWatchHttpError";
  }
}

function requiredEnvironment(
  environment: SpendWatchEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (value) return value;
  const error = new Error(`${name} is required`);
  error.name = `MissingEnvironment:${name}`;
  throw error;
}

function errorClass(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function failureCode(error: unknown): string {
  if (error instanceof SpendWatchHttpError) return `HTTP_${error.status}`;
  return errorClass(error);
}

function elapsed(clock: () => number, startedAt: number): number {
  const value = clock() - startedAt;
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function auditReportRequest(
  audit: AuditLogger,
  status: AuditRecord["status"],
  latencyMs: number,
  response: AuditRecord["response"],
  schemaValid: boolean,
): void {
  audit({
    adapter: "spend-watch",
    latencyMs,
    operation: "fetch_report",
    request: { method: "POST", path: "/api/cron/spend-report" },
    response,
    schemaValid,
    status,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSpendWatchReport(value: unknown): value is SpendWatchReport {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  const day = value.day;
  const cycle = value.cycle;
  const coverage = value.coverage;
  return (
    typeof value.generatedAt === "string" &&
    isRecord(day) &&
    typeof day.start === "string" &&
    typeof day.end === "string" &&
    typeof day.llmUsd === "number" &&
    Array.isArray(day.lines) &&
    typeof day.unpricedCalls === "number" &&
    isRecord(cycle) &&
    typeof cycle.start === "string" &&
    typeof cycle.end === "string" &&
    typeof cycle.derivedUsd === "number" &&
    typeof cycle.declaredMonthlyUsd === "number" &&
    isRecord(coverage) &&
    typeof coverage.unmeteredServices === "number" &&
    typeof coverage.unpricedCalls === "number" &&
    typeof coverage.inFlightCalls === "number" &&
    coverage.nonLlmDollarsAvailable === false
  );
}

async function fetchSpendReport(
  endpoint: string,
  originSecret: string,
  fetchImpl: typeof fetch,
  audit: AuditLogger,
  clock: () => number,
): Promise<SpendWatchReport> {
  const startedAt = clock();
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      headers: { "x-origin-verify": originSecret },
      method: "POST",
    });
  } catch (error) {
    auditReportRequest(
      audit,
      "failure",
      elapsed(clock, startedAt),
      { error: errorClass(error) },
      false,
    );
    throw error;
  }

  if (!response.ok) {
    const error = new SpendWatchHttpError(response.status);
    auditReportRequest(
      audit,
      "failure",
      elapsed(clock, startedAt),
      { httpStatus: response.status, error: failureCode(error) },
      false,
    );
    throw error;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    auditReportRequest(
      audit,
      "failure",
      elapsed(clock, startedAt),
      { httpStatus: response.status, error: errorClass(error) },
      false,
    );
    throw error;
  }

  if (!isSpendWatchReport(body)) {
    const error = new Error("Spend report response schema is invalid");
    error.name = "InvalidSpendReport";
    auditReportRequest(
      audit,
      "failure",
      elapsed(clock, startedAt),
      { httpStatus: response.status, error: error.name },
      false,
    );
    throw error;
  }

  auditReportRequest(
    audit,
    "success",
    elapsed(clock, startedAt),
    { httpStatus: response.status },
    true,
  );
  return body;
}

function usd(value: number | null | undefined): string {
  return `$${(typeof value === "number" && Number.isFinite(value)
    ? value
    : 0
  ).toFixed(2)}`;
}

function units(value: number | null | undefined): string {
  return String(
    typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0,
  );
}

function unitName(value: string | null | undefined, fallback: string): string {
  const name = value?.split(/[ /]/, 1)[0]?.trim();
  return name || fallback;
}

function lineFor(report: SpendWatchReport, id: string) {
  return report.day.lines.find((line) => line.id === id);
}

function dateLabel(report: SpendWatchReport): string {
  return report.generatedAt.slice(0, 10);
}

function successNotification(report: SpendWatchReport): AgentNotification {
  const serper = lineFor(report, "serper");
  const resend = lineFor(report, "resend");
  return {
    agent: `spend — ${dateLabel(report)}`,
    details: [
      `• LLM ${usd(report.day.llmUsd)} · Serper ${units(serper?.units)} ${unitName(serper?.unitLabel, "credits")} ${usd(serper?.amountUsd)} · Resend ${units(resend?.units)} ${unitName(resend?.unitLabel, "sends")} ${usd(resend?.amountUsd)}`,
      `• ${report.coverage.unpricedCalls} unpriced calls · ${report.coverage.inFlightCalls} in-flight · ${report.coverage.unmeteredServices} services unmetered`,
    ],
    status: "success",
    summary: [
      `• Yesterday: ${usd(report.day.llmUsd)} derived`,
      `• Cycle to date: ${usd(report.cycle.derivedUsd)} derived · ~${usd(report.cycle.declaredMonthlyUsd)}/mo declared fixed`,
    ],
  };
}

function failedNotification(
  error: unknown,
  clock: () => number,
): AgentNotification {
  return {
    agent: `spend — ${new Date(clock()).toISOString().slice(0, 10)}`,
    details: ["• The spend endpoint did not return a usable report."],
    status: "failed",
    summary: [`• Spend report failed (${failureCode(error)})`],
  };
}

async function sendNotification(
  notification: AgentNotification,
  webhookUrl: string,
  dependencies: {
    audit: AuditLogger;
    clock: () => number;
    fetchImpl: typeof fetch;
  },
): Promise<void> {
  const report: SlackReport = { notification };
  await sendSlackDigest(report, {
    audit: dependencies.audit,
    fetchImpl: dependencies.fetchImpl,
    now: dependencies.clock,
    webhookUrl,
  });
}

const defaultAudit: AuditLogger = (record) => {
  console.log(JSON.stringify({ event: "spend_watch_audit", ...record }));
};

export async function runSpendReport(
  dependencies: SpendWatchDependencies = {},
): Promise<SpendWatchResult> {
  const environment = dependencies.env ?? process.env;
  const audit = dependencies.audit ?? defaultAudit;
  const clock = dependencies.clock ?? Date.now;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    process.exitCode = 1;
    throw new Error("A fetch implementation is required");
  }

  let endpoint: string;
  let originSecret: string;
  let webhookUrl: string;
  try {
    const baseUrl = requiredEnvironment(environment, "FORMORIA_RAILWAY_URL");
    endpoint = `${baseUrl.replace(/\/+$/, "")}/api/cron/spend-report`;
    originSecret = requiredEnvironment(environment, "ORIGIN_SECRET");
    webhookUrl = requiredEnvironment(environment, "SLACK_HEALTH_WEBHOOK_URL");
  } catch (error) {
    process.exitCode = 1;
    throw error;
  }

  let report: SpendWatchReport;
  try {
    report = await fetchSpendReport(
      endpoint,
      originSecret,
      fetchImpl,
      audit,
      clock,
    );
  } catch (error) {
    const notification = failedNotification(error, clock);
    try {
      await sendNotification(notification, webhookUrl, {
        audit,
        clock,
        fetchImpl,
      });
    } catch (slackError) {
      process.exitCode = 1;
      throw slackError;
    }
    process.exitCode = 1;
    return { notification, status: "failed" };
  }

  const notification = successNotification(report);
  try {
    await sendNotification(notification, webhookUrl, {
      audit,
      clock,
      fetchImpl,
    });
  } catch (error) {
    process.exitCode = 1;
    throw error;
  }
  return { notification, report, status: "success" };
}

async function main(): Promise<void> {
  await runSpendReport();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "spend_watch_failed",
        error: errorClass(error),
      }),
    );
    process.exitCode = 1;
  });
}
