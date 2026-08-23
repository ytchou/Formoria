import { pathToFileURL } from "node:url";

import {
  sendSlackDigest,
  type AgentNotification,
  type SlackReport,
} from "../health-agent/adapters";
import type { AuditLogger, AuditRecord } from "../health-agent/contracts";
import { isoDateInTimeZone } from "@/lib/date-range";
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isSpendLine(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.amountUsd === null || isFiniteNumber(value.amountUsd)) &&
    (value.units === null || isFiniteNumber(value.units)) &&
    (value.unitLabel === null || typeof value.unitLabel === "string")
  );
}

function isAlertMeter(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    [
      "ready",
      "unsupported",
      "unconfigured",
      "error",
      "not_applicable",
    ].includes(String(value.state)) &&
    ["normal", "warning", "critical", "unknown"].includes(String(value.risk)) &&
    (value.value === null || isFiniteNumber(value.value)) &&
    (value.limit === null || isFiniteNumber(value.limit)) &&
    (value.percentage === null || isFiniteNumber(value.percentage)) &&
    (value.projection === null || isFiniteNumber(value.projection)) &&
    (value.message === null || typeof value.message === "string")
  );
}

function isOperationalAlertSummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.needsAttention === "boolean" &&
    typeof value.unavailableUpstash === "boolean" &&
    Array.isArray(value.warnings) &&
    value.warnings.every((item) => typeof item === "string") &&
    Array.isArray(value.lowerBoundCaveats) &&
    value.lowerBoundCaveats.every((item) => typeof item === "string") &&
    (value.openai === null || isAlertMeter(value.openai)) &&
    (value.upstash === null || isAlertMeter(value.upstash)) &&
    (value.posthog === null || isAlertMeter(value.posthog)) &&
    // Optional during a deploy skew: the report endpoint may still be the
    // build that predates the Railway meter.
    (value.railway === undefined ||
      value.railway === null ||
      isAlertMeter(value.railway)) &&
    (value.railwayMemory === undefined ||
      value.railwayMemory === null ||
      isAlertMeter(value.railwayMemory))
  );
}

function isSpendWatchReport(value: unknown): value is SpendWatchReport {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  const day = value.day;
  const cycle = value.cycle;
  const coverage = value.coverage;
  return (
    isTimestamp(value.generatedAt) &&
    isRecord(day) &&
    isTimestamp(day.start) &&
    isTimestamp(day.end) &&
    isFiniteNumber(day.llmUsd) &&
    Array.isArray(day.lines) &&
    day.lines.every(isSpendLine) &&
    isFiniteNumber(day.unpricedCalls) &&
    isRecord(cycle) &&
    isTimestamp(cycle.start) &&
    isTimestamp(cycle.end) &&
    isFiniteNumber(cycle.derivedUsd) &&
    isFiniteNumber(cycle.declaredMonthlyUsd) &&
    isRecord(coverage) &&
    isFiniteNumber(coverage.unmeteredServices) &&
    isFiniteNumber(coverage.unpricedCalls) &&
    isFiniteNumber(coverage.inFlightCalls) &&
    coverage.nonLlmDollarsAvailable === false &&
    (value.operations === undefined ||
      isOperationalAlertSummary(value.operations))
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

// Egress is a fractional daily figure; the integer `units` formatter would
// round a 1.2 GB day down to "1". Callers guard `null` themselves and render
// "unknown" -- a null must never be printed as a measured "0.00 GB".
function gb(value: number): string {
  return `${value.toFixed(2)} GB`;
}

function unitName(value: string | null | undefined, fallback: string): string {
  const name = value?.split(/[ /]/, 1)[0]?.trim();
  return name || fallback;
}

function lineFor(report: SpendWatchReport, id: string) {
  return report.day.lines.find((line) => line.id === id);
}

function dateLabel(report: SpendWatchReport): string {
  return isoDateInTimeZone(report.generatedAt, "Asia/Taipei");
}

function operationalMeterLine(
  label: string,
  meter: NonNullable<SpendWatchReport["operations"]>["openai"],
  unit: "usd" | "units" | "gb",
): string {
  if (!meter) return `• ${label}: unavailable`;
  const format = (amount: number): string =>
    unit === "usd" ? usd(amount) : unit === "gb" ? gb(amount) : units(amount);
  const value = meter.value === null ? "unknown" : format(meter.value);
  const limit =
    meter.limit === null ? "no authoritative limit" : format(meter.limit);
  const headroom =
    meter.value !== null && meter.limit !== null
      ? format(Math.max(0, meter.limit - meter.value))
      : "unknown";
  const percentage =
    meter.percentage === null
      ? "unknown"
      : `${Math.round(meter.percentage * 100)}%`;
  const projection =
    meter.projection === null
      ? "unknown"
      : `${Math.round(meter.projection * 100)}%`;
  return `• ${label}: ${value}/${limit} (${percentage}) · headroom ${headroom} · projection ${projection} · ${meter.risk}`;
}

function successNotification(report: SpendWatchReport): AgentNotification {
  const serper = lineFor(report, "serper");
  const resend = lineFor(report, "resend");
  const operations = report.operations;
  const operationDetails = operations
    ? [
        operationalMeterLine("OpenAI budget", operations.openai, "usd"),
        operationalMeterLine("Upstash commands", operations.upstash, "units"),
        operationalMeterLine("PostHog events", operations.posthog, "units"),
        operationalMeterLine("Railway egress", operations.railway, "gb"),
        // The memory metric rides `operations.railwayMemory`; without its own
        // line a memory warning reaches Slack with no value, unit, or limit.
        operationalMeterLine(
          "Railway memory (7d mean)",
          operations.railwayMemory,
          "gb",
        ),
        ...operations.lowerBoundCaveats.map((caveat) => `• Caveat: ${caveat}`),
      ]
    : [];
  return {
    agent: `spend — ${dateLabel(report)}`,
    details: [
      `• LLM ${usd(report.day.llmUsd)} · Serper ${units(serper?.units)} ${unitName(serper?.unitLabel, "credits")} ${usd(serper?.amountUsd)} · Resend ${units(resend?.units)} ${unitName(resend?.unitLabel, "sends")} ${usd(resend?.amountUsd)}`,
      `• ${report.coverage.unpricedCalls} unpriced calls · ${report.coverage.inFlightCalls} in-flight · ${report.coverage.unmeteredServices} services unmetered`,
      ...operationDetails,
    ],
    status: operations?.needsAttention ? "needs_attention" : "success",
    summary: [
      `• Yesterday: ${usd(report.day.llmUsd)} derived`,
      `• Cycle to date: ${usd(report.cycle.derivedUsd)} derived · ~${usd(report.cycle.declaredMonthlyUsd)}/mo declared fixed`,
      ...(operations?.warnings ?? []),
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
  return { notification, report, status: notification.status };
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
