import {
  boundedSlackText,
  renderAgentNotification,
  type AgentNotification,
  type AgentNotificationStatus,
} from "@/lib/adapters/slack/notification";
import {
  requiresHumanPolicy,
  type AuditLogger,
  type HealthFinding,
  type HealthSummary,
  type JsonValue,
} from "./contracts";

// Slack notification rendering lives in `src/lib/adapters/slack` so that
// application code can reuse it without importing from `scripts/`. Re-exported
// here to keep existing importers (scripts/notifications/e2e-slack.ts and the
// GitHub Actions path) working unchanged.
export { renderAgentNotification, type AgentNotification };

type FetchImplementation = typeof fetch;
type Clock = () => number;
type SafeRecord = Record<string, JsonValue>;

export interface AdapterDependencies {
  audit?: AuditLogger;
  auditLogger?: AuditLogger;
  clock?: Clock;
  fetch?: FetchImplementation;
  fetchImplementation?: FetchImplementation;
  fetchImpl?: FetchImplementation;
  logger?: AuditLogger;
  now?: Clock;
}

export class HealthAdapterError extends Error {
  public readonly httpStatus: number | null;

  public readonly operation: string;

  constructor(
    message: string,
    public readonly adapter: string,
    operation: string,
    httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "HealthAdapterError";
    this.httpStatus = httpStatus;
    this.operation = operation;
  }
}

const noopAudit: AuditLogger = () => undefined;
const defaultClock: Clock = () => performance.now();

function dependencies(options: AdapterDependencies): {
  audit: AuditLogger;
  clock: Clock;
  fetchImpl: FetchImplementation;
} {
  const fetchImpl =
    options.fetchImpl ??
    options.fetchImplementation ??
    options.fetch ??
    globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required");
  }
  return {
    audit: options.audit ?? options.auditLogger ?? options.logger ?? noopAudit,
    clock: options.now ?? options.clock ?? defaultClock,
    fetchImpl,
  };
}

function elapsed(clock: Clock, startedAt: number): number {
  const value = clock() - startedAt;
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function emitAudit(
  audit: AuditLogger,
  adapter: string,
  operation: string,
  status: "success" | "failure" | "suppressed",
  latencyMs: number,
  request: SafeRecord,
  response: SafeRecord,
  schemaValid: boolean,
): void {
  audit({
    adapter,
    latencyMs,
    operation,
    request,
    response,
    schemaValid,
    status,
  });
}

function emitSuppressed(
  audit: AuditLogger,
  adapter: string,
  operation: string,
  request: SafeRecord,
  response: SafeRecord,
): void {
  emitAudit(
    audit,
    adapter,
    operation,
    "suppressed",
    0,
    request,
    response,
    true,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

async function responseJson(response: Response): Promise<{
  parsed: boolean;
  value: unknown;
}> {
  try {
    if (typeof response.text === "function") {
      const text = await response.text();
      if (!text.trim()) return { parsed: true, value: null };
      try {
        return { parsed: true, value: JSON.parse(text) as unknown };
      } catch {
        return { parsed: false, value: null };
      }
    }

    const candidate = response as Response & { json?: () => Promise<unknown> };
    if (typeof candidate.json === "function") {
      return { parsed: true, value: await candidate.json() };
    }
  } catch {
    return { parsed: false, value: null };
  }
  return { parsed: true, value: null };
}

interface ExternalRequestOptions {
  parseJson?: boolean;
  request: SafeRecord;
  validate?: (value: unknown) => boolean;
}

interface ExternalResponse {
  body: unknown;
  status: number;
}

function providerErrors(value: unknown): JsonValue[] {
  if (!isRecord(value) || !Array.isArray(value.errors)) return [];
  return value.errors.slice(0, 3).map((entry) => {
    if (!isRecord(entry)) return { message: "provider_error" };
    const message = stringValue(entry.message)
      ?.replace(/https?:\/\/\S+/gi, "[redacted-url]")
      .replace(/(?:token|secret|password)\s*[:=]\s*\S+/gi, "[redacted-secret]")
      .slice(0, 300);
    const extensions = isRecord(entry.extensions)
      ? entry.extensions
      : undefined;
    const code = extensions
      ? stringValue(extensions.code)
          ?.replace(/(?:token|secret|password)\s*[:=]\s*\S+/gi, "[redacted]")
          .replace(/[^a-z0-9_.-]+/gi, "_")
          .slice(0, 80)
      : undefined;
    return {
      ...(code ? { code } : {}),
      message: message ?? "provider_error",
    };
  });
}

async function externalRequest(
  deps: ReturnType<typeof dependencies>,
  adapter: string,
  operation: string,
  url: string,
  init: RequestInit,
  options: ExternalRequestOptions,
): Promise<ExternalResponse> {
  const startedAt = deps.clock();
  const displayName =
    adapter === "agent-hub"
      ? "Agent Hub"
      : `${adapter.slice(0, 1).toUpperCase()}${adapter.slice(1)}`;
  let response: Response;
  try {
    response = await deps.fetchImpl(url, init);
  } catch {
    emitAudit(
      deps.audit,
      adapter,
      operation,
      "failure",
      elapsed(deps.clock, startedAt),
      options.request,
      { error: "network_failure" },
      false,
    );
    throw new HealthAdapterError(
      `${displayName} request failed`,
      adapter,
      operation,
    );
  }

  const status = response.status;
  const parsed =
    options.parseJson === false
      ? { parsed: true, value: null }
      : await responseJson(response);
  if (!isSuccessStatus(status)) {
    const errors = providerErrors(parsed.value);
    emitAudit(
      deps.audit,
      adapter,
      operation,
      "failure",
      elapsed(deps.clock, startedAt),
      options.request,
      {
        httpStatus: status,
        ...(errors.length > 0 ? { providerErrors: errors } : {}),
      },
      parsed.parsed,
    );
    throw new HealthAdapterError(
      `${displayName} request failed${errors.length > 0 && isRecord(errors[0]) ? `: ${String(errors[0].message)}` : ""}`,
      adapter,
      operation,
      status,
    );
  }

  const schemaValid =
    parsed.parsed && (!options.validate || options.validate(parsed.value));
  if (!schemaValid) {
    const errors = providerErrors(parsed.value);
    emitAudit(
      deps.audit,
      adapter,
      operation,
      "failure",
      elapsed(deps.clock, startedAt),
      options.request,
      {
        httpStatus: status,
        error: "invalid_response",
        ...(errors.length > 0 ? { providerErrors: errors } : {}),
      },
      false,
    );
    throw new HealthAdapterError(
      `${displayName} returned an invalid response${errors.length > 0 && isRecord(errors[0]) ? `: ${String(errors[0].message)}` : ""}`,
      adapter,
      operation,
      status,
    );
  }

  emitAudit(
    deps.audit,
    adapter,
    operation,
    "success",
    elapsed(deps.clock, startedAt),
    options.request,
    { httpStatus: status },
    true,
  );
  return { body: parsed.value, status };
}

function asNonemptyString(value: unknown, message: string): string {
  const result = stringValue(value);
  if (!result) throw new Error(message);
  return result;
}

function sectionEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.outcomes)) return value.outcomes;
  return value === undefined || value === null ? [] : [value];
}

function firstArraySection(report: SlackReport, keys: string[]): unknown[] {
  const source = report as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (source[key] !== undefined) return sectionEntries(source[key]);
  }
  return [];
}

function findingLines(findings: unknown[]): string[] {
  return findings.slice(0, 3).map((value) => {
    if (!isRecord(value)) return "- Untitled finding (unknown)";
    const title = stringValue(value.title) ?? "Untitled finding";
    const source = stringValue(value.source) ?? "unknown";
    const severity = stringValue(value.severity)?.toUpperCase() ?? "UNKNOWN";
    return `- [${severity}] ${title.slice(0, 180)} (${source})`;
  });
}

function groupedCounts(entries: unknown[], key: string): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const value = isRecord(entry) ? stringValue(entry[key]) : undefined;
    const label = value ?? "unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, count]) => `${label}: ${count}`)
    .join(", ");
}

function failureLines(entries: unknown[]): string[] {
  return entries.slice(0, 3).map((entry) => {
    if (typeof entry === "string") return `- ${entry.slice(0, 180)}`;
    if (!isRecord(entry)) return "- Unspecified failure";
    const reason =
      stringValue(entry.reason) ??
      stringValue(entry.failure) ??
      stringValue(entry.status);
    return `- ${(reason ?? "Unspecified failure").slice(0, 180)}`;
  });
}

export type SlackEntry = string | Readonly<Record<string, JsonValue>>;

export interface SlackReport {
  actionableFindings?: readonly HealthFinding[];
  failures?: readonly SlackEntry[] | SlackEntry;
  findings?: readonly HealthFinding[];
  healthSummary?: HealthSummary;
  notification?: AgentNotification;
  linear?: readonly SlackEntry[] | SlackEntry;
  linearOutcomes?: readonly SlackEntry[] | SlackEntry;
  prOutcomes?: readonly SlackEntry[] | SlackEntry;
  pullRequests?: readonly SlackEntry[] | SlackEntry;
  pullRequestOutcomes?: readonly SlackEntry[] | SlackEntry;
  skipped?: readonly SlackEntry[] | SlackEntry;
  skippedActions?: readonly SlackEntry[] | SlackEntry;
  workflowUrl?: string;
}

function renderHealthSummary(
  summary: HealthSummary,
  workflowUrl?: string,
): string {
  const total = Object.values(summary.checks).reduce(
    (count, check) => count + check.findingCount,
    0,
  );
  const lifecycle = summary.lifecycle ?? {
    new: total,
    ongoing: 0,
    regressed: 0,
  };
  const failedPhases = Object.entries(summary.phases)
    .filter(([, status]) => status === "failed")
    .map(([phase]) => phase);
  const pipeline =
    failedPhases.length > 0 ? failedPhases.join(", ") : "All phases completed";
  const batchLines = summary.repair.batches
    ? (["automatic", "human"] as const).flatMap((policy) => {
        const batch = summary.repair.batches![policy];
        if (batch.findingCount === 0 && !batch.prUrl) return [];
        const label = policy === "automatic" ? "Automatic" : "Human";
        const state = batch.status.replaceAll("_", " ");
        const pr =
          batch.prNumber && batch.prUrl
            ? ` · <${batch.prUrl}|PR #${batch.prNumber}>`
            : "";
        return [`• ${label} — ${batch.findingCount} · ${state}${pr}`];
      })
    : [];
  return renderAgentNotification({
    agent: "Health Agent",
    details: [
      `• Links ${summary.checks.link.findingCount} · Directory ${summary.checks.directory.findingCount} · Sentry ${summary.checks.sentry.findingCount} · Repository ${summary.checks.quality.findingCount}`,
      `• Pipeline: ${pipeline}`,
    ],
    managerAction: operationalManagerAction(summary, pipeline),
    status:
      summary.overallStatus === "healthy"
        ? "success"
        : summary.overallStatus === "needs_attention"
          ? "needs_attention"
          : "failed",
    summary: [
      `• ${total} total · ${lifecycle.new} new · ${lifecycle.ongoing} ongoing · ${lifecycle.regressed} regressed`,
      `• ${summary.repair.repaired ?? 0} repaired this run · ${summary.repair.unresolved} unresolved`,
    ],
    workDone: [
      `• ${summary.repair.pullRequests} repair PR${summary.repair.pullRequests === 1 ? "" : "s"}`,
      ...batchLines,
    ],
    workflowUrl,
  });
}

function operationalManagerAction(summary: HealthSummary, pipeline: string) {
  if (summary.overallStatus === "healthy") return "None";
  const repairPr = Object.values(summary.repair.batches ?? {}).find(
    (batch) => batch.prUrl,
  );
  if (repairPr?.prUrl) {
    const pr = `<${repairPr.prUrl}|Review PR${repairPr.prNumber ? ` #${repairPr.prNumber}` : ""}>`;
    return summary.ticket
      ? `${pr} and track <${summary.ticket.url}|${summary.ticket.identifier}>`
      : pr;
  }
  if (summary.overallStatus === "failed")
    return summary.ticket
      ? `Investigate ${pipeline} and review <${summary.ticket.url}|${summary.ticket.identifier}>`
      : `Investigate ${pipeline}`;
  if (summary.ticket)
    return `<${summary.ticket.url}|${summary.ticket.identifier}> requires review`;
  if (summary.repair.pullRequests > 0)
    return "Review the repair PR links above";
  return pipeline === "All phases completed"
    ? "Review unresolved findings"
    : pipeline;
}

export function renderSlackDigest(report: SlackReport): string {
  if (report.notification) return renderAgentNotification(report.notification);
  if (report.healthSummary) {
    return renderHealthSummary(report.healthSummary, report.workflowUrl);
  }
  const source = report as unknown as Record<string, unknown>;
  const findings = Array.isArray(source.actionableFindings)
    ? source.actionableFindings
    : Array.isArray(source.findings)
      ? source.findings
      : [];
  const skipped = firstArraySection(report, ["skippedActions", "skipped"]);
  const failures = firstArraySection(report, ["failures"]);
  const linear = firstArraySection(report, ["linearOutcomes", "linear"]);
  const pullRequests = firstArraySection(report, [
    "pullRequestOutcomes",
    "pullRequests",
    "prOutcomes",
  ]);

  const details: string[] = [];
  const summary: string[] = [];
  if (findings.length > 0) {
    const severities = groupedCounts(findings, "severity");
    const sources = groupedCounts(findings, "source");
    const remaining = Math.max(0, findings.length - 3);
    summary.push(`• ${findings.length} findings (${severities}; ${sources})`);
    details.push(
      `• Findings\n${findingLines(findings).join("\n")}${remaining > 0 ? `\n- …and ${remaining} more` : ""}`,
    );
  }
  if (skipped.length > 0) {
    details.push(
      `• Skipped actions (${skipped.length})\n${failureLines(skipped).join("\n")}`,
    );
  }
  if (failures.length > 0) {
    details.push(
      `• Failures (${failures.length})\n${failureLines(failures).join("\n")}`,
    );
  }
  if (linear.length > 0) {
    details.push(
      `• Linear (${linear.length}) — ${groupedCounts(linear, "status")}`,
    );
  }
  if (pullRequests.length > 0) {
    details.push(
      `• PR outcomes (${pullRequests.length})\n${failureLines(pullRequests).join("\n")}`,
    );
  }
  const status: AgentNotificationStatus =
    failures.length > 0
      ? "failed"
      : findings.length > 0 || linear.length > 0 || pullRequests.length > 0
        ? "needs_attention"
        : "success";
  if (summary.length === 0) summary.push("• All clear");
  return renderAgentNotification({
    agent: "Health Agent",
    details,
    managerAction:
      failures.length > 0
        ? "Investigate the failed workflow"
        : findings.length > 0 || linear.length > 0 || pullRequests.length > 0
          ? "Review unresolved findings"
          : "None",
    status,
    summary,
    workflowUrl: report.workflowUrl,
  });
}

export interface SlackAdapterOptions extends AdapterDependencies {
  url?: string;
  webhookUrl?: string;
}

export interface SlackAdapter {
  sendDigest(report: SlackReport): Promise<number>;
  send(report: SlackReport): Promise<number>;
}

export async function sendSlackDigest(
  report: SlackReport,
  options: SlackAdapterOptions,
): Promise<number> {
  const webhookUrl = asNonemptyString(
    options.webhookUrl ?? options.url,
    "Slack webhook URL is required",
  );
  const deps = dependencies(options);
  const text = boundedSlackText(renderSlackDigest(report));
  await externalRequest(
    deps,
    "slack",
    "send_message",
    webhookUrl,
    {
      body: JSON.stringify({ text }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
    {
      parseJson: false,
      request: {
        channel: "incoming_webhook",
        characterCount: Array.from(text).length,
      },
    },
  );
  return 1;
}

export function createSlackAdapter(options: SlackAdapterOptions): SlackAdapter {
  return {
    sendDigest: (report) => sendSlackDigest(report, options),
    send: (report) => sendSlackDigest(report, options),
  };
}

function linearAuthorization(options: LinearAdapterOptions): string {
  if (options.apiKey) {
    return asNonemptyString(options.apiKey, "Linear API key is required");
  }
  const oauthToken =
    options.oauthAccessToken ??
    options.oauthToken ??
    options.accessToken ??
    options.token;
  if (oauthToken) {
    return `Bearer ${asNonemptyString(oauthToken, "Linear OAuth token is required")}`;
  }
  throw new Error("Linear API credential is required");
}

function graphqlData(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  if (Array.isArray(value.errors) && value.errors.length > 0) return null;
  return value.data;
}

function graphqlDataHas(
  field: string,
  value: unknown,
  child = "nodes",
): boolean {
  const data = graphqlData(value);
  const container = data?.[field];
  return isRecord(container) && Array.isArray(container[child]);
}

function labelNodes(value: unknown): Record<string, unknown>[] {
  const data = graphqlData(value);
  const container = data?.issueLabels;
  return isRecord(container) && Array.isArray(container.nodes)
    ? container.nodes.filter(isRecord)
    : [];
}

export interface LinearAdapterOptions extends AdapterDependencies {
  accessToken?: string;
  apiKey?: string;
  assigneeId?: string;
  endpoint?: string;
  oauthAccessToken?: string;
  oauthToken?: string;
  projectId: string;
  teamId: string;
  token?: string;
}

export interface LinearSyncInput {
  exhaustedAutomation?: readonly (HealthFinding | string)[];
  exhaustedAutomationFingerprints?: readonly string[];
  findings: readonly HealthFinding[];
  summary?: LinearSyncSummary;
}

export interface LinearSyncSummary {
  fixed: number;
  newFindings: number;
  ongoingFindings: number;
  pullRequestUrls?: readonly string[];
  regressedFindings: number;
  reviewFindings: number;
  runAt?: string;
  status: "failed" | "needs_attention" | "resolved";
  totalFindings: number;
  unresolved: number;
  workflowUrl?: string;
}

export interface LinearSyncOptions {
  exhaustedAutomation?: readonly (HealthFinding | string)[];
  exhaustedAutomationFingerprints?: readonly string[];
}

export interface LinearOutcome {
  action: "created" | "updated";
  fingerprint: string;
  identifier?: string;
}

export interface LinearSyncResult {
  created: number;
  outcomes: LinearOutcome[];
  skipped: number;
  updated: number;
}

export interface LinearAdapter {
  upsert(
    input: readonly HealthFinding[] | LinearSyncInput,
    options?: LinearSyncOptions,
  ): Promise<LinearSyncResult>;
  sync(
    input: readonly HealthFinding[] | LinearSyncInput,
    options?: LinearSyncOptions,
  ): Promise<LinearSyncResult>;
}

const LINEAR_LABEL_QUERY = `
  query HealthAgentLabels($after: String) {
    issueLabels(first: 100, after: $after) {
      nodes { id name team { id } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const LINEAR_CREATE_MUTATION = `
  mutation HealthAgentIssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) { success issue { id identifier } }
  }
`;

const LINEAR_LABEL_CREATE_MUTATION = `
  mutation HealthAgentLabelCreate($input: IssueLabelCreateInput!) {
    issueLabelCreate(input: $input) { success issueLabel { id name } }
  }
`;

const LINEAR_SUMMARY_FINGERPRINT = "health-agent:summary:v2";
// Traceability marker only. Nothing reads it back — each run creates a fresh
// digest ticket, so there is no existing issue to look up.
const LINEAR_SUMMARY_V2_MARKER = "<!-- health-agent:summary:v2 -->";
const LINEAR_TAIPEI_TIME_ZONE = "Asia/Taipei";

function linearRunDate(runAt: string | undefined): string {
  const date = runAt ? new Date(runAt) : new Date();
  const resolved = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: LINEAR_TAIPEI_TIME_ZONE,
    year: "numeric",
  }).formatToParts(resolved);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function groupedLinearDescription(
  findings: readonly HealthFinding[],
  summary?: LinearSyncSummary,
): string {
  const sources = (["sentry", "directory", "link", "quality"] as const)
    .map((source) => {
      const matches = findings.filter((finding) => finding.source === source);
      if (matches.length === 0) return undefined;
      const label = {
        directory: "Directory",
        link: "Link",
        quality: "Repository",
        sentry: "Sentry",
      }[source];
      const titles = new Map<string, number>();
      for (const finding of matches) {
        titles.set(finding.title, (titles.get(finding.title) ?? 0) + 1);
      }
      const groups = [...titles.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 20)
        .map(([title, count]) => {
          const samples = matches
            .filter((finding) => finding.title === title)
            .slice(0, 5)
            .map((finding) => finding.fingerprint)
            .join(", ");
          return `  - ${count} × ${title}${samples ? ` — ${samples}` : ""}`;
        });
      return `- ${label}: ${matches.length}\n${groups.join("\n")}`;
    })
    .filter((line): line is string => Boolean(line));
  const severities = (["critical", "high", "medium", "low"] as const)
    .map(
      (severity) =>
        [
          severity,
          findings.filter((finding) => finding.severity === severity).length,
        ] as const,
    )
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => `${count} ${severity}`)
    .join(", ");
  const summaryLines = summary
    ? [
        `**Run status:** ${summary.status.replaceAll("_", " ")}`,
        summary.runAt ? `**Run at:** ${summary.runAt}` : undefined,
        summary.workflowUrl
          ? `**Workflow:** ${summary.workflowUrl}`
          : undefined,
        `**Findings:** ${summary.totalFindings} total (${summary.reviewFindings} review-required)`,
        `**Lifecycle:** ${summary.newFindings} new · ${summary.ongoingFindings} ongoing · ${summary.regressedFindings} regressed`,
        `**Fixed:** ${summary.fixed}`,
        `**Unresolved:** ${summary.unresolved}`,
        `**Work done:** ${summary.pullRequestUrls?.length ? summary.pullRequestUrls.join(", ") : "No repair PR created"}`,
      ].filter((line): line is string => Boolean(line))
    : [
        `**Findings:** ${findings.length} review-required`,
        "**Lifecycle:** New review findings",
        "**Fixed:** 0 at triage time",
        "**Unresolved:** Pending final verification",
        "**Work done:** No repair PR created yet",
      ];
  return [
    LINEAR_SUMMARY_V2_MARKER,
    `# Health Agent review summary`,
    "",
    ...summaryLines,
    "",
    `**Severity:** ${severities || "unclassified"}`,
    "",
    "## Grouped findings",
    ...(sources.length > 0 ? sources : ["No active findings."]),
    "",
    `**Manager action:** ${summary?.status === "resolved" ? "No action needed; resolution was verified" : summary?.status === "failed" ? "Investigate the failed workflow; resolution was not verified" : "Review unresolved findings"}`,
  ].join("\n");
}

function normalizeLinearInput(
  input: readonly HealthFinding[] | LinearSyncInput,
  options: LinearSyncOptions,
): {
  exhausted: Set<string>;
  findings: readonly HealthFinding[];
  summary?: LinearSyncSummary;
} {
  const value: LinearSyncInput = Array.isArray(input)
    ? { findings: input as readonly HealthFinding[] }
    : (input as LinearSyncInput);
  const exhausted = new Set<string>();
  for (const candidate of [
    ...(value.exhaustedAutomation ?? []),
    ...(value.exhaustedAutomationFingerprints ?? []),
    ...(options.exhaustedAutomation ?? []),
    ...(options.exhaustedAutomationFingerprints ?? []),
  ]) {
    const fingerprint =
      typeof candidate === "string" ? candidate : candidate.fingerprint;
    if (fingerprint.trim()) exhausted.add(fingerprint);
  }
  return { exhausted, findings: value.findings, summary: value.summary };
}

// The count is the number of findings carried by THIS ticket, never
// summary.totalFindings — that mismatch is what produced the misleading
// "37 active findings" on the old rolling ticket.
function linearSummaryTitle(
  summary: LinearSyncSummary | undefined,
  eligibleCount: number,
): string {
  return `Health Agent — ${eligibleCount} new finding${eligibleCount === 1 ? "" : "s"} (${linearRunDate(summary?.runAt)})`;
}

function linearLabelName(finding: HealthFinding): "Data Quality" | "Ops" {
  return finding.source === "sentry" ? "Ops" : "Data Quality";
}

function linearMutationResult(
  data: Record<string, unknown>,
  field: "issueCreate",
): { identifier?: string; success: boolean } {
  const result = data[field];
  if (!isRecord(result) || typeof result.success !== "boolean") {
    throw new HealthAdapterError(
      "Linear returned an invalid mutation response",
      "linear",
      field,
    );
  }
  if (!result.success) {
    throw new HealthAdapterError(
      "Linear issue mutation failed",
      "linear",
      field,
    );
  }
  const issue = result.issue;
  return {
    identifier: isRecord(issue) ? stringValue(issue.identifier) : undefined,
    success: true,
  };
}

export async function syncLinearFindings(
  input: readonly HealthFinding[] | LinearSyncInput,
  options: LinearAdapterOptions,
  syncOptions: LinearSyncOptions = {},
): Promise<LinearSyncResult> {
  const normalized = normalizeLinearInput(input, syncOptions);
  const eligible: HealthFinding[] = [];
  const seen = new Set<string>();
  for (const finding of normalized.findings) {
    const runtimeFinding = finding as HealthFinding & {
      automationExhausted?: boolean;
    };
    const isEligible =
      requiresHumanPolicy(finding) ||
      normalized.exhausted.has(finding.fingerprint) ||
      runtimeFinding.automationExhausted === true;
    if (!isEligible || seen.has(finding.fingerprint)) continue;
    seen.add(finding.fingerprint);
    eligible.push(finding);
  }

  const skipped = normalized.findings.length - eligible.length;
  const result: LinearSyncResult = {
    created: 0,
    outcomes: [],
    skipped,
    updated: 0,
  };
  const deps = dependencies(options);
  // Create-only: with no eligible findings there is nothing to file. There is
  // no rolling ticket left to refresh with the run summary either.
  if (eligible.length === 0) {
    emitSuppressed(
      deps.audit,
      "linear",
      "filter_findings",
      { candidateCount: normalized.findings.length, eligibleCount: 0 },
      { reason: "no_human_or_exhausted_findings" },
    );
    return result;
  }

  const endpoint = options.endpoint ?? "https://api.linear.app/graphql";
  const teamId = asNonemptyString(options.teamId, "Linear team ID is required");
  const projectId = asNonemptyString(
    options.projectId,
    "Linear project ID is required",
  );
  const assigneeId = asNonemptyString(
    options.assigneeId,
    "Linear assignee ID is required",
  );
  const headers = {
    Accept: "application/json",
    Authorization: linearAuthorization(options),
    "Content-Type": "application/json",
  };
  let labels: Map<"Data Quality" | "Ops", string> | null = null;

  const graphql = async (
    operation: string,
    query: string,
    variables: Record<string, unknown>,
    validate: (value: unknown) => boolean,
  ): Promise<Record<string, unknown>> => {
    const response = await externalRequest(
      deps,
      "linear",
      operation,
      endpoint,
      {
        body: JSON.stringify({ query, variables }),
        headers,
        method: "POST",
      },
      {
        request: { resource: operation, transport: "graphql" },
        validate,
      },
    );
    const data = graphqlData(response.body);
    if (!data) {
      throw new HealthAdapterError(
        "Linear returned an invalid response",
        "linear",
        operation,
      );
    }
    return data;
  };

  const loadLabels = async (): Promise<Map<"Data Quality" | "Ops", string>> => {
    if (labels) return labels;
    const next = new Map<"Data Quality" | "Ops", string>();
    const labelCursors = new Set<string>();
    let labelAfter: string | undefined;
    do {
      const data = await graphql(
        "lookup_labels",
        LINEAR_LABEL_QUERY,
        labelAfter ? { after: labelAfter } : {},
        (value) => graphqlDataHas("issueLabels", value),
      );
      for (const node of labelNodes({ data })) {
        const name = node.name;
        const team = node.team;
        const id = stringValue(node.id);
        const teamValue = isRecord(team) ? stringValue(team.id) : undefined;
        if (
          id &&
          (teamValue === teamId || team === null) &&
          (name === "Data Quality" || name === "Ops")
        ) {
          next.set(name, id);
        }
      }
      const issueLabels = data.issueLabels;
      const pageInfo = isRecord(issueLabels) ? issueLabels.pageInfo : undefined;
      const hasNextPage = isRecord(pageInfo) && pageInfo.hasNextPage === true;
      labelAfter = hasNextPage ? stringValue(pageInfo.endCursor) : undefined;
      if (hasNextPage && (!labelAfter || labelCursors.has(labelAfter))) {
        throw new HealthAdapterError(
          "Linear returned invalid pagination metadata",
          "linear",
          "lookup_labels",
        );
      }
      if (labelAfter) labelCursors.add(labelAfter);
    } while (labelAfter);
    labels = next;
    return next;
  };

  const requiredLabels = new Set(eligible.map(linearLabelName));
  const allowedLabels =
    requiredLabels.size > 0 ? await loadLabels() : new Map();
  for (const name of requiredLabels) {
    if (allowedLabels.has(name)) continue;
    const data = await graphql(
      "create_label",
      LINEAR_LABEL_CREATE_MUTATION,
      { input: { name, teamId } },
      (value) => {
        const payload = graphqlData(value)?.issueLabelCreate;
        return (
          isRecord(payload) &&
          payload.success === true &&
          isRecord(payload.issueLabel) &&
          stringValue(payload.issueLabel.id) !== undefined
        );
      },
    );
    const payload = data.issueLabelCreate;
    const issueLabel = isRecord(payload) ? payload.issueLabel : undefined;
    const labelId = isRecord(issueLabel)
      ? stringValue(issueLabel.id)
      : undefined;
    if (!labelId) {
      throw new HealthAdapterError(
        "Linear label creation failed",
        "linear",
        "create_label",
      );
    }
    allowedLabels.set(name, labelId);
  }

  {
    const labelIds = [...requiredLabels].map((name) => {
      const labelId = allowedLabels.get(name);
      if (!labelId)
        throw new HealthAdapterError(
          "Linear label is not configured",
          "linear",
          "validate_labels",
        );
      return labelId;
    });
    // The body describes exactly the findings carried by this ticket, so it
    // can never disagree with the count in the title.
    const inputPayload: Record<string, JsonValue> = {
      assigneeId,
      description: groupedLinearDescription(eligible, normalized.summary),
      projectId,
      title: linearSummaryTitle(normalized.summary, eligible.length),
    };
    if (labelIds.length > 0) inputPayload.labelIds = labelIds;

    // Always create. A digest ticket is a per-run record; existing tickets are
    // never revisited, whatever a human has since done to their state.
    const data = await graphql(
      "create_issue",
      LINEAR_CREATE_MUTATION,
      {
        input: {
          ...inputPayload,
          teamId,
        },
      },
      (value) => {
        const data = graphqlData(value);
        const mutation = data?.issueCreate;
        return isRecord(mutation) && mutation.success === true;
      },
    );
    const mutation = linearMutationResult(data, "issueCreate");
    result.created += 1;
    result.outcomes.push({
      action: "created",
      ...(mutation.identifier ? { identifier: mutation.identifier } : {}),
      fingerprint: LINEAR_SUMMARY_FINGERPRINT,
    });
  }
  return result;
}

export function createLinearAdapter(
  options: LinearAdapterOptions,
): LinearAdapter {
  return {
    sync: (input, syncOptions = {}) =>
      syncLinearFindings(input, options, syncOptions),
    upsert: (input, syncOptions = {}) =>
      syncLinearFindings(input, options, syncOptions),
  };
}

export interface SentryResolverOptions extends AdapterDependencies {
  baseUrl: string;
  organizationSlug?: string;
  projectSlug?: string;
  readToken?: string;
  resolveToken?: string;
  sentryWriteToken?: string;
  writeAccessToken?: string;
  writeToken?: string;
}

export interface SentryResolver {
  resolve(issueIds: readonly string[]): Promise<number>;
  resolveIssues(issueIds: readonly string[]): Promise<number>;
}

function sentryWriteToken(options: SentryResolverOptions): string {
  return asNonemptyString(
    options.writeAccessToken ??
      options.writeToken ??
      options.resolveToken ??
      options.sentryWriteToken,
    "Sentry write token is required",
  );
}

function explicitIssueIds(issueIds: readonly string[]): string[] {
  if (!Array.isArray(issueIds))
    throw new Error("Explicit Sentry issue IDs are required");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const issueId of issueIds) {
    const value = asNonemptyString(
      issueId,
      "Explicit Sentry issue IDs are required",
    );
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

export async function resolveSentryIssues(
  issueIds: readonly string[],
  options: SentryResolverOptions,
): Promise<number> {
  const ids = explicitIssueIds(issueIds);
  const deps = dependencies(options);
  if (ids.length === 0) {
    emitSuppressed(
      deps.audit,
      "sentry",
      "resolve_issues",
      { requestedCount: 0 },
      { reason: "no_explicit_issue_ids" },
    );
    return 0;
  }
  const token = sentryWriteToken(options);
  const baseUrl = asNonemptyString(
    options.baseUrl,
    "Sentry base URL is required",
  );
  let parsedBase: URL;
  try {
    parsedBase = new URL(baseUrl);
  } catch {
    throw new Error("Sentry base URL is invalid");
  }

  let resolved = 0;
  for (const issueId of ids) {
    const url = new URL(
      `/api/0/issues/${encodeURIComponent(issueId)}/`,
      parsedBase,
    ).toString();
    await externalRequest(
      deps,
      "sentry",
      "resolve_issue",
      url,
      {
        body: JSON.stringify({ status: "resolved" }),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "PUT",
      },
      {
        request: { action: "resolve", resource: "issue" },
        validate: (value) => value === null || isRecord(value),
      },
    );
    resolved += 1;
  }
  return resolved;
}

export function createSentryResolver(
  options: SentryResolverOptions,
): SentryResolver {
  return {
    resolve: (issueIds) => resolveSentryIssues(issueIds, options),
    resolveIssues: (issueIds) => resolveSentryIssues(issueIds, options),
  };
}

export interface GitHubAdapterOptions extends AdapterDependencies {
  accessToken?: string;
  appToken?: string;
  baseUrl?: string;
  owner: string;
  repo: string;
  token?: string;
}

export interface GitHubBranchDeletionRequest {
  branch: string;
  expectedTipSha?: string;
}

export interface GitHubBranchDeletionResult {
  evidence: SafeRecord;
  outcome: "deleted" | "skipped";
  reason?: string;
  tipSha?: string;
}

export interface GitHubAdapter {
  deleteBranch(
    request: GitHubBranchDeletionRequest | string,
    expectedTipSha?: string,
  ): Promise<GitHubBranchDeletionResult>;
  deleteBranchIfSafe(
    request: GitHubBranchDeletionRequest | string,
    expectedTipSha?: string,
  ): Promise<GitHubBranchDeletionResult>;
}

function githubToken(options: GitHubAdapterOptions): string {
  return asNonemptyString(
    options.appToken ?? options.accessToken ?? options.token,
    "GitHub access token is required",
  );
}

function githubUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function branchRef(value: unknown): { ref: string; sha: string } | null {
  if (!isRecord(value) || !isRecord(value.object)) return null;
  const ref = stringValue(value.ref);
  const sha = stringValue(value.object.sha);
  return ref && sha ? { ref, sha } : null;
}

function skipBranch(
  deps: ReturnType<typeof dependencies>,
  reason: string,
  evidence: SafeRecord,
  tipSha?: string,
): GitHubBranchDeletionResult {
  emitSuppressed(deps.audit, "github", "delete_branch_policy", evidence, {
    reason,
  });
  return {
    evidence,
    outcome: "skipped",
    reason,
    ...(tipSha ? { tipSha } : {}),
  };
}

function isHttpError(error: unknown, status: number): boolean {
  return error instanceof HealthAdapterError && error.httpStatus === status;
}

export async function deleteGitHubBranch(
  request: GitHubBranchDeletionRequest,
  options: GitHubAdapterOptions,
): Promise<GitHubBranchDeletionResult> {
  const branch = asNonemptyString(request.branch, "GitHub branch is required");
  const deps = dependencies(options);
  const expectedTipSha = stringValue(request.expectedTipSha);
  if (!expectedTipSha) {
    return skipBranch(deps, "missing recorded tip", {
      expectedTipRecorded: false,
    });
  }
  const token = githubToken(options);
  const baseUrl = options.baseUrl ?? "https://api.github.com";
  try {
    new URL(baseUrl);
  } catch {
    throw new Error("GitHub base URL is invalid");
  }
  const repoPath = `/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`;
  const headers = githubHeaders(token);
  const get = async (
    operation: string,
    path: string,
    requestAudit: SafeRecord,
    validate: (value: unknown) => boolean,
  ) =>
    externalRequest(
      deps,
      "github",
      operation,
      githubUrl(baseUrl, path),
      { headers, method: "GET" },
      { request: requestAudit, validate },
    );

  const repository = await get(
    "get_repository",
    repoPath,
    { resource: "repository" },
    (value) => isRecord(value) && typeof value.default_branch === "string",
  );
  const repositoryBody = repository.body as Record<string, unknown>;
  const defaultBranch = asNonemptyString(
    repositoryBody.default_branch,
    "GitHub default branch is required",
  );

  let branchMetadata: ExternalResponse;
  try {
    branchMetadata = await get(
      "get_branch_protection",
      `${repoPath}/branches/${encodeURIComponent(branch)}`,
      { resource: "branch_protection" },
      (value) => isRecord(value) && typeof value.protected === "boolean",
    );
  } catch (error) {
    if (isHttpError(error, 404)) {
      return skipBranch(deps, "branch missing", { branchPresent: false });
    }
    throw error;
  }
  const branchBody = branchMetadata.body as Record<string, unknown>;

  let initialRef: ExternalResponse;
  try {
    initialRef = await get(
      "get_exact_ref",
      `${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`,
      { resource: "exact_branch_ref" },
      (value) => branchRef(value) !== null,
    );
  } catch (error) {
    if (isHttpError(error, 404)) {
      return skipBranch(deps, "branch missing", { branchPresent: false });
    }
    throw error;
  }
  const firstRef = branchRef(initialRef.body);
  if (!firstRef || firstRef.ref !== `refs/heads/${branch}`) {
    return skipBranch(deps, "ref mismatch", { exactRefVerified: false });
  }
  if (branch === defaultBranch) {
    return skipBranch(
      deps,
      "default branch",
      { branchIsDefault: true, defaultBranchKnown: true },
      firstRef.sha,
    );
  }
  if (branchBody.protected === true) {
    return skipBranch(
      deps,
      "protected branch",
      { protected: true },
      firstRef.sha,
    );
  }
  if (expectedTipSha !== firstRef.sha) {
    return skipBranch(
      deps,
      "tip race",
      { expectedTipKnown: true, tipUnchanged: false },
      firstRef.sha,
    );
  }

  const pullsUrl = new URL(`${repoPath}/pulls`, baseUrl);
  pullsUrl.searchParams.set("head", `${options.owner}:${branch}`);
  pullsUrl.searchParams.set("state", "open");
  pullsUrl.searchParams.set("per_page", "100");
  const pullRequests = await externalRequest(
    deps,
    "github",
    "get_open_pull_requests",
    pullsUrl.toString(),
    { headers, method: "GET" },
    {
      request: { resource: "open_pull_requests" },
      validate: (value) => Array.isArray(value) && value.every(isRecord),
    },
  );
  const openPullRequests = pullRequests.body as unknown[];
  if (openPullRequests.length > 0) {
    return skipBranch(
      deps,
      "open pull request",
      { openPullRequestCount: openPullRequests.length },
      firstRef.sha,
    );
  }

  const compare = await get(
    "compare_tip_to_default",
    `${repoPath}/compare/${encodeURIComponent(firstRef.sha)}...${encodeURIComponent(defaultBranch)}`,
    { resource: "ancestor_check" },
    (value) => isRecord(value) && typeof value.status === "string",
  );
  const compareBody = compare.body as Record<string, unknown>;
  const compareStatus = stringValue(compareBody.status);
  const baseCommit = isRecord(compareBody.base_commit)
    ? stringValue(compareBody.base_commit.sha)
    : undefined;
  const mergeBaseCommit = isRecord(compareBody.merge_base_commit)
    ? stringValue(compareBody.merge_base_commit.sha)
    : undefined;
  const tipIsAncestor =
    compareStatus === "ahead" || compareStatus === "identical";
  const exactBaseMatches = !baseCommit || baseCommit === firstRef.sha;
  const exactMergeBaseMatches =
    !mergeBaseCommit || mergeBaseCommit === firstRef.sha;
  if (!tipIsAncestor || !exactBaseMatches || !exactMergeBaseMatches) {
    return skipBranch(
      deps,
      "not an ancestor",
      { compareStatus: compareStatus ?? "unknown", exactTipIsAncestor: false },
      firstRef.sha,
    );
  }

  const latestRef = await get(
    "refetch_exact_ref",
    `${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`,
    { resource: "exact_branch_ref_before_delete" },
    (value) => branchRef(value) !== null,
  );
  const secondRef = branchRef(latestRef.body);
  if (
    !secondRef ||
    secondRef.ref !== `refs/heads/${branch}` ||
    secondRef.sha !== firstRef.sha
  ) {
    return skipBranch(
      deps,
      "tip race",
      { exactRefVerified: true, tipUnchanged: false },
      firstRef.sha,
    );
  }

  await externalRequest(
    deps,
    "github",
    "delete_branch_ref",
    githubUrl(
      baseUrl,
      `${repoPath}/git/refs/heads/${encodeURIComponent(branch)}`,
    ),
    { headers, method: "DELETE" },
    { parseJson: false, request: { resource: "exact_branch_ref" } },
  );
  return {
    evidence: { exactTipVerified: true, openPullRequestCount: 0 },
    outcome: "deleted",
    tipSha: firstRef.sha,
  };
}

export function createGitHubAdapter(
  options: GitHubAdapterOptions,
): GitHubAdapter {
  const deleteBranch = (
    request: GitHubBranchDeletionRequest | string,
    expectedTipSha?: string,
  ) =>
    deleteGitHubBranch(
      typeof request === "string"
        ? { branch: request, expectedTipSha }
        : request,
      options,
    );
  return {
    deleteBranch,
    deleteBranchIfSafe: deleteBranch,
  };
}

export type AgentHubRunner = (envelope: unknown) => Promise<unknown>;

export interface AgentHubAdapterOptions extends AdapterDependencies {
  runner: AgentHubRunner;
}

export interface NormalizedAgentHubOutcome {
  duplicate: boolean | null;
  reported: boolean;
  runIdPresent: boolean;
}

export interface AgentHubAdapter {
  delegate(envelope: unknown): Promise<unknown>;
  report(envelope: unknown): Promise<unknown>;
}

export function normalizeAgentHubOutcome(
  value: unknown,
): NormalizedAgentHubOutcome {
  if (!isRecord(value)) {
    return { duplicate: null, reported: true, runIdPresent: false };
  }
  const runId = stringValue(value.run_id) ?? stringValue(value.runId);
  return {
    duplicate: typeof value.duplicate === "boolean" ? value.duplicate : null,
    reported: true,
    runIdPresent: Boolean(runId),
  };
}

export async function delegateToAgentHub(
  envelope: unknown,
  options: AgentHubAdapterOptions,
): Promise<unknown> {
  const deps = dependencies(options);
  const startedAt = deps.clock();
  try {
    const result = await options.runner(envelope);
    const normalized = normalizeAgentHubOutcome(result);
    const schemaValid =
      isRecord(result) &&
      typeof result.duplicate === "boolean" &&
      Boolean(stringValue(result.run_id) ?? stringValue(result.runId));
    emitAudit(
      deps.audit,
      "agent-hub",
      "delegate",
      "success",
      elapsed(deps.clock, startedAt),
      { envelopeProvided: envelope !== undefined, source: "health_agent" },
      {
        duplicate: normalized.duplicate,
        reported: normalized.reported,
        runIdPresent: normalized.runIdPresent,
      },
      schemaValid,
    );
    return result;
  } catch (error) {
    emitAudit(
      deps.audit,
      "agent-hub",
      "delegate",
      "failure",
      elapsed(deps.clock, startedAt),
      { envelopeProvided: envelope !== undefined, source: "health_agent" },
      { error: "runner_failed" },
      false,
    );
    throw error;
  }
}

export function createAgentHubAdapter(
  options: AgentHubAdapterOptions,
): AgentHubAdapter {
  const report = (envelope: unknown) => delegateToAgentHub(envelope, options);
  return {
    delegate: report,
    report,
  };
}
