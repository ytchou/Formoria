/**
 * @formoria-script
 * purpose: Sends the daily external-spend digest built from the audit log to Slack.
 * class: scheduled-automation
 * invoke: pnpm exec tsx scripts/spend-watch/report.ts
 * target: ci
 * safety: read-only
 * owner: engineering
 */
import { pathToFileURL } from "node:url";

import { type AgentNotification } from "../health-agent/adapters";
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
    (value.message === null || typeof value.message === "string") &&
    // Optional during a deploy skew: the report endpoint may still be the
    // build that predates these fields.
    (value.window === undefined ||
      value.window === null ||
      isUsageWindow(value.window)) &&
    (value.subject === undefined ||
      value.subject === null ||
      typeof value.subject === "string")
  );
}

function isUsageWindow(value: unknown): boolean {
  return isRecord(value) && isTimestamp(value.start) && isTimestamp(value.end);
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
    (value.sentry === undefined || value.sentry === null || isAlertMeter(value.sentry)) &&
    (value.resend === undefined || value.resend === null || isAlertMeter(value.resend)) &&
    (value.langfuse === undefined || value.langfuse === null || isAlertMeter(value.langfuse)) &&
    (value.github === undefined || value.github === null || isAlertMeter(value.github))
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

export function humanNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  return String(Math.round(value));
}

export function isEffectivelyUnlimited(limit: number | null): boolean {
  if (limit === null) return true;
  return limit > 1e15;
}

export function progressBar(percentage: number | null, width = 10): string {
  if (percentage === null) return "░".repeat(width);
  const filled = Math.round(Math.min(1, Math.max(0, percentage)) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

type SlackBlock = Record<string, unknown>;

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
  unit: "usd" | "units",
): string {
  if (!meter) return `• ${label}: unavailable`;
  const format = (amount: number): string =>
    unit === "usd" ? usd(amount) : units(amount);
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
  const subject = meter.subject ? ` · ${meter.subject}` : "";
  return `• ${label}: ${value}/${limit} (${percentage}) · headroom ${headroom} · projection ${projection} · ${meter.risk}${subject}`;
}

type OperationalMeter = NonNullable<SpendWatchReport["operations"]>["openai"];

// Extended with fields being added by a parallel worker in the same wave.
// The wave gate validates the combined type after both workers complete.
type ExtendedOps = NonNullable<SpendWatchReport["operations"]> & {
  sentry?: OperationalMeter | null;
  resend?: OperationalMeter | null;
  langfuse?: OperationalMeter | null;
  github?: OperationalMeter | null;
};

function meterField(
  label: string,
  meter: OperationalMeter,
  unit: string,
): { type: "mrkdwn"; text: string } {
  if (!meter || meter.value === null) {
    return { type: "mrkdwn", text: `*${label}*\n${progressBar(null)}\nunavailable` };
  }
  const bar = progressBar(meter.percentage);
  const pct = meter.percentage !== null ? ` ${Math.round(meter.percentage * 100)}%` : "";
  const valueStr = humanNumber(meter.value);
  const limitStr = isEffectivelyUnlimited(meter.limit)
    ? `${valueStr} ${unit} · no cap`
    : `${valueStr}/${humanNumber(meter.limit!)} ${unit}`;
  return { type: "mrkdwn", text: `*${label}*\n${bar}${pct}\n${limitStr}` };
}

export function buildSpendBlocks(report: SpendWatchReport): SlackBlock[] {
  const ops = report.operations as ExtendedOps | undefined;
  const statusEmoji = ops?.needsAttention ? "⚠️ Needs Attention" : "✅ OK";

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Formoria spend — ${dateLabel(report)}`, emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: statusEmoji }],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: "*💰 Spend*" },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Yesterday*\n${usd(report.day.llmUsd)} LLM cost` },
        { type: "mrkdwn", text: `*Cycle to date*\n${usd(report.cycle.derivedUsd)} derived / ~${usd(report.cycle.declaredMonthlyUsd)} fixed` },
      ],
    },
  ];

  if (ops?.openai) {
    const openaiField = meterField("OpenAI budget", ops.openai, "USD");
    // Override to show USD formatting for the value/limit
    const bar = progressBar(ops.openai.percentage);
    const pct = ops.openai.percentage !== null ? ` ${Math.round(ops.openai.percentage * 100)}%` : "";
    const valueStr = usd(ops.openai.value);
    const limitStr = isEffectivelyUnlimited(ops.openai.limit)
      ? `${valueStr} · no cap`
      : `${valueStr}/${usd(ops.openai.limit!)}`;
    openaiField.text = `*OpenAI budget*\n${bar}${pct}\n${limitStr}`;
    blocks.push({
      type: "section",
      fields: [openaiField],
    });
  }

  blocks.push({ type: "divider" });

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*📊 Quotas*" },
  });

  if (ops) {
    const quotaFields: { type: "mrkdwn"; text: string }[] = [];
    quotaFields.push(meterField("PostHog", ops.posthog, "events"));
    quotaFields.push(meterField("Upstash", ops.upstash, "commands"));
    if (ops.sentry != null) {
      quotaFields.push(meterField("Sentry", ops.sentry, "errors"));
    }
    if (ops.resend != null) {
      quotaFields.push(meterField("Resend", ops.resend, "sends"));
    }
    if (ops.langfuse != null) {
      quotaFields.push(meterField("Langfuse", ops.langfuse, "observations"));
    }
    if (ops.github != null) {
      quotaFields.push(meterField("GitHub Actions", ops.github, "runs"));
    }

    // Slack fields limit: 10 per section, split into pairs for two-column layout
    for (let i = 0; i < quotaFields.length; i += 2) {
      blocks.push({
        type: "section",
        fields: quotaFields.slice(i, i + 2),
      });
    }
  }

  if (ops?.needsAttention && ops.warnings.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*⚠️ Warnings*\n${ops.warnings.map((w) => `• ${w}`).join("\n")}`,
      },
    });
  }

  if (ops && ops.lowerBoundCaveats.length > 0) {
    blocks.push({
      type: "context",
      elements: ops.lowerBoundCaveats.map((caveat) => ({
        type: "mrkdwn",
        text: `_${caveat}_`,
      })),
    });
  }

  return blocks;
}

function buildFailedBlocks(error: unknown, clock: () => number): SlackBlock[] {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Formoria spend — ${new Date(clock()).toISOString().slice(0, 10)}`,
        emoji: true,
      },
    },
    { type: "context", elements: [{ type: "mrkdwn", text: "❌ Failed" }] },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `The spend endpoint did not return a usable report.\nError: \`${failureCode(error)}\``,
      },
    },
  ];
}

async function sendSpendBlocks(
  blocks: SlackBlock[],
  fallbackText: string,
  webhookUrl: string,
  dependencies: { audit: AuditLogger; clock: () => number; fetchImpl: typeof fetch },
): Promise<void> {
  const startedAt = dependencies.clock();
  const response = await dependencies.fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: fallbackText, blocks }),
  });
  dependencies.audit({
    adapter: "spend-watch",
    latencyMs: elapsed(dependencies.clock, startedAt),
    operation: "send_slack_blocks",
    request: { channel: "incoming_webhook", blockCount: blocks.length },
    response: { httpStatus: response.status },
    schemaValid: true,
    status: response.ok ? "success" : "failure",
  });
  if (!response.ok) throw new Error(`Slack webhook returned HTTP ${response.status}`);
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
    const failedBlocks = buildFailedBlocks(error, clock);
    const failedFallback = `Formoria spend — ${new Date(clock()).toISOString().slice(0, 10)}: FAILED (${failureCode(error)})`;
    try {
      await sendSpendBlocks(failedBlocks, failedFallback, webhookUrl, {
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

  const blocks = buildSpendBlocks(report);
  const fallbackText = `Formoria spend — ${dateLabel(report)}: ${usd(report.day.llmUsd)} LLM · ${usd(report.cycle.derivedUsd)} cycle`;
  try {
    await sendSpendBlocks(blocks, fallbackText, webhookUrl, {
      audit,
      clock,
      fetchImpl,
    });
  } catch (error) {
    process.exitCode = 1;
    throw error;
  }
  const notification = successNotification(report);
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
