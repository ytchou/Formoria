import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  delegateToAgentHub,
  resolveSentryIssues,
  sendSlackDigest,
  syncLinearFindings,
  type SlackReport,
} from "./adapters";
import type { AuditRecord, HealthFinding, JsonValue } from "./contracts";

export const HEALTH_PR_LABEL = "health-agent";
export const HEALTH_PR_MARKER = "<!-- health-agent:confirmation:v1 -->";
export const RAILWAY_CREATOR = "railway-app[bot]";
export const RAILWAY_PRODUCTION_ENVIRONMENT = "Formoria / production";

type QueueStatus =
  | "pr_opened"
  | "awaiting_human"
  | "merged"
  | "deployed"
  | "fixed"
  | "failed"
  | "needs_human";

export interface HealthFixRow {
  evidence: Record<string, JsonValue>;
  fingerprint: string;
  id: string;
  merge_policy: "automatic" | "human";
  merge_sha: string | null;
  pr_number: number | null;
  sentry_issue_id: string | null;
  source: "directory" | "link" | "sentry";
  status: QueueStatus;
  title: string;
}

export type ConfirmationEvent =
  | {
      kind: "pull_request_closed";
      mergeSha: string | null;
      merged: boolean;
      number: number;
      url: string;
    }
  | {
      creator: string;
      environment: string;
      kind: "deployment_status";
      sha: string;
      state: string;
      url: string | null;
    };

export interface TransitionInput {
  confirmationData?: Record<string, JsonValue>;
  deployedAt?: string;
  expectedStatus: QueueStatus;
  id: string;
  lastError?: string;
  mergeSha?: string;
  newStatus: QueueStatus;
  prNumber?: number;
  prUrl?: string;
}

export interface SmokeResult {
  body: { status: "ok" };
  checkedAt: string;
  httpStatus: number;
  url: string;
}

interface LinearResult {
  tickets: string[];
}

export interface ConfirmationDependencies {
  agentHub(envelope: ConfirmationEnvelope): Promise<unknown>;
  linear(rows: readonly HealthFixRow[]): Promise<LinearResult>;
  resolveSentry(issueIds: readonly string[]): Promise<number>;
  slack(report: SlackReport): Promise<unknown>;
  smoke(sha: string): Promise<SmokeResult>;
  transition(input: TransitionInput): Promise<HealthFixRow>;
}

export interface ConfirmationEnvelope {
  data: {
    action: string;
    finding_count: number;
    notification_owner: "github_actions";
    pr_number: number | null;
    sha: string | null;
  };
  date: string;
  log_url?: string;
  project: "formoria";
  routine: "health-confirmation";
  run_at: string;
  source: "github_actions";
  source_run_id: string;
  status: "failed" | "skipped" | "success";
  tickets_created: string[];
  verdict_severity: "critical" | "info" | "ok";
  verdict_text: string;
  version: 1;
}

export interface DeliveryOutcome {
  agentHub: "failed" | "sent";
  slack: "failed" | "sent";
}

export interface ConfirmationResult {
  action:
    | "closed_unmerged"
    | "deployment_confirmed"
    | "deployment_failed"
    | "ignored"
    | "merged_recorded"
    | "smoke_failed"
    | "wrong_sha";
  delivery?: DeliveryOutcome;
  findingCount: number;
  linear: "failed" | "not_required" | "sent";
  sentryResolved: number;
  status: "failed" | "skipped" | "success";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} is invalid`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${field} is invalid`);
  }
  return Number(value);
}

function validSha(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{40}$/.test(value);
}

function healthPullRequest(pullRequest: Record<string, unknown>): boolean {
  const labels = pullRequest.labels;
  const hasLabel =
    Array.isArray(labels) &&
    labels.some((label) => isRecord(label) && label.name === HEALTH_PR_LABEL);
  const body = pullRequest.body;
  const hasMarker =
    typeof body === "string" &&
    body.split(/\r?\n/).some((line) => line.trim() === HEALTH_PR_MARKER);
  return hasLabel && hasMarker;
}

export function parseConfirmationEvent(
  eventName: string,
  payload: unknown,
): ConfirmationEvent | null {
  const root = requiredRecord(payload, "event payload");
  if (eventName === "pull_request") {
    if (root.action !== "closed") return null;
    const pullRequest = requiredRecord(root.pull_request, "pull_request");
    if (!healthPullRequest(pullRequest)) return null;
    return {
      kind: "pull_request_closed",
      mergeSha: optionalString(pullRequest.merge_commit_sha),
      merged: pullRequest.merged === true,
      number: requiredInteger(pullRequest.number, "pull_request.number"),
      url: requiredString(pullRequest.html_url, "pull_request.html_url"),
    };
  }

  if (eventName === "deployment_status") {
    const deployment = requiredRecord(root.deployment, "deployment");
    const status = requiredRecord(root.deployment_status, "deployment_status");
    const creator = requiredRecord(deployment.creator, "deployment.creator");
    return {
      creator: requiredString(creator.login, "deployment.creator.login"),
      environment: requiredString(
        deployment.environment,
        "deployment.environment",
      ),
      kind: "deployment_status",
      sha: requiredString(deployment.sha, "deployment.sha"),
      state: requiredString(status.state, "deployment_status.state"),
      url: optionalString(status.environment_url),
    };
  }
  return null;
}

export function isTrustedRailwayDeployment(
  event: Extract<ConfirmationEvent, { kind: "deployment_status" }>,
): boolean {
  return (
    event.creator === RAILWAY_CREATOR &&
    event.environment === RAILWAY_PRODUCTION_ENVIRONMENT &&
    validSha(event.sha)
  );
}

function taipeiDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Taipei",
    year: "numeric",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function envelope({
  action,
  event,
  findingCount,
  now,
  sourceRunId,
  status,
  tickets,
  verdict,
  workflowUrl,
}: {
  action: string;
  event: ConfirmationEvent;
  findingCount: number;
  now: Date;
  sourceRunId: string;
  status: ConfirmationEnvelope["status"];
  tickets: string[];
  verdict: string;
  workflowUrl?: string;
}): ConfirmationEnvelope {
  const prNumber = event.kind === "pull_request_closed" ? event.number : null;
  const sha = event.kind === "pull_request_closed" ? event.mergeSha : event.sha;
  return {
    data: {
      action,
      finding_count: findingCount,
      notification_owner: "github_actions",
      pr_number: prNumber,
      sha,
    },
    date: taipeiDate(now),
    ...(workflowUrl ? { log_url: workflowUrl } : {}),
    project: "formoria",
    routine: "health-confirmation",
    run_at: now.toISOString(),
    source: "github_actions",
    source_run_id: sourceRunId,
    status,
    tickets_created: tickets,
    verdict_severity:
      status === "failed" ? "critical" : status === "success" ? "ok" : "info",
    verdict_text: verdict,
    version: 1,
  };
}

async function deliverIndependently(
  deps: ConfirmationDependencies,
  report: SlackReport,
  agentHubEnvelope: ConfirmationEnvelope,
): Promise<DeliveryOutcome> {
  const [slack, agentHub] = await Promise.allSettled([
    deps.slack(report),
    deps.agentHub(agentHubEnvelope),
  ]);
  return {
    agentHub: agentHub.status === "fulfilled" ? "sent" : "failed",
    slack: slack.status === "fulfilled" ? "sent" : "failed",
  };
}

function isDeliveryFailure(delivery: DeliveryOutcome): boolean {
  return delivery.agentHub === "failed" || delivery.slack === "failed";
}

function matchingPrRows(
  rows: readonly HealthFixRow[],
  prNumber: number,
): HealthFixRow[] {
  return rows.filter(
    (row) =>
      row.pr_number === prNumber &&
      (row.status === "pr_opened" || row.status === "awaiting_human"),
  );
}

function matchingDeploymentRows(
  rows: readonly HealthFixRow[],
  sha: string,
): HealthFixRow[] {
  return rows.filter((row) => row.status === "merged" && row.merge_sha === sha);
}

function explicitSentryIds(rows: readonly HealthFixRow[]): string[] {
  return [
    ...new Set(
      rows
        .map((row) => row.sentry_issue_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

async function failureResult({
  action,
  deps,
  event,
  findingCount,
  message,
  now,
  sourceRunId,
  workflowUrl,
}: {
  action: ConfirmationResult["action"];
  deps: ConfirmationDependencies;
  event: ConfirmationEvent;
  findingCount: number;
  message: string;
  now: Date;
  sourceRunId: string;
  workflowUrl?: string;
}): Promise<ConfirmationResult> {
  const delivery = await deliverIndependently(
    deps,
    { failures: [message] },
    envelope({
      action,
      event,
      findingCount,
      now,
      sourceRunId,
      status: "failed",
      tickets: [],
      verdict: message,
      workflowUrl,
    }),
  );
  return {
    action,
    delivery,
    findingCount,
    linear: "not_required",
    sentryResolved: 0,
    status: "failed",
  };
}

export async function confirmHealthEvent({
  dependencies: deps,
  event,
  now = new Date(),
  rows,
  sourceRunId,
  workflowUrl,
}: {
  dependencies: ConfirmationDependencies;
  event: ConfirmationEvent | null;
  now?: Date;
  rows: readonly HealthFixRow[];
  sourceRunId: string;
  workflowUrl?: string;
}): Promise<ConfirmationResult> {
  if (!event) {
    return {
      action: "ignored",
      findingCount: 0,
      linear: "not_required",
      sentryResolved: 0,
      status: "skipped",
    };
  }

  if (event.kind === "pull_request_closed") {
    const matched = matchingPrRows(rows, event.number);
    if (matched.length === 0) {
      return {
        action: "ignored",
        findingCount: 0,
        linear: "not_required",
        sentryResolved: 0,
        status: "skipped",
      };
    }

    if (!event.merged) {
      for (const row of matched) {
        await deps.transition({
          expectedStatus: row.status,
          id: row.id,
          lastError: "Health PR was closed without merge",
          newStatus: "needs_human",
        });
      }
      let linear: ConfirmationResult["linear"] = "sent";
      let tickets: string[] = [];
      try {
        tickets = (await deps.linear(matched)).tickets;
      } catch {
        linear = "failed";
      }
      const message = `Health PR #${event.number} closed without merge; ${matched.length} finding(s) require human action.`;
      const delivery = await deliverIndependently(
        deps,
        {
          failures: [message],
          linearOutcomes: tickets,
          prOutcomes: [event.url],
        },
        envelope({
          action: "closed_unmerged",
          event,
          findingCount: matched.length,
          now,
          sourceRunId,
          status: "failed",
          tickets,
          verdict: message,
          workflowUrl,
        }),
      );
      return {
        action: "closed_unmerged",
        delivery,
        findingCount: matched.length,
        linear,
        sentryResolved: 0,
        status:
          linear === "failed" || isDeliveryFailure(delivery)
            ? "failed"
            : "success",
      };
    }

    if (!validSha(event.mergeSha)) {
      return failureResult({
        action: "deployment_failed",
        deps,
        event,
        findingCount: matched.length,
        message: `Merged health PR #${event.number} did not include a valid authoritative merge SHA.`,
        now,
        sourceRunId,
        workflowUrl,
      });
    }
    for (const row of matched) {
      await deps.transition({
        expectedStatus: row.status,
        id: row.id,
        mergeSha: event.mergeSha,
        newStatus: "merged",
        prNumber: event.number,
        prUrl: event.url,
      });
    }
    const message = `Recorded authoritative merge SHA for health PR #${event.number}; awaiting Railway production deployment.`;
    const delivery = await deliverIndependently(
      deps,
      { prOutcomes: [message] },
      envelope({
        action: "merged_recorded",
        event,
        findingCount: matched.length,
        now,
        sourceRunId,
        status: "success",
        tickets: [],
        verdict: message,
        workflowUrl,
      }),
    );
    return {
      action: "merged_recorded",
      delivery,
      findingCount: matched.length,
      linear: "not_required",
      sentryResolved: 0,
      status: isDeliveryFailure(delivery) ? "failed" : "success",
    };
  }

  if (!isTrustedRailwayDeployment(event)) {
    return {
      action: "ignored",
      findingCount: 0,
      linear: "not_required",
      sentryResolved: 0,
      status: "skipped",
    };
  }
  const matched = matchingDeploymentRows(rows, event.sha);
  const activeRows = rows.filter((row) => row.status === "merged");
  if (matched.length === 0) {
    if (event.state === "success" && activeRows.length > 0) {
      return failureResult({
        action: "wrong_sha",
        deps,
        event,
        findingCount: activeRows.length,
        message:
          "Railway production deployment SHA did not match any merged health PR.",
        now,
        sourceRunId,
        workflowUrl,
      });
    }
    return {
      action: "ignored",
      findingCount: 0,
      linear: "not_required",
      sentryResolved: 0,
      status: "skipped",
    };
  }
  if (event.state !== "success") {
    if (["failure", "error", "inactive"].includes(event.state)) {
      return failureResult({
        action: "deployment_failed",
        deps,
        event,
        findingCount: matched.length,
        message: `Railway production deployment for ${event.sha} reported ${event.state}.`,
        now,
        sourceRunId,
        workflowUrl,
      });
    }
    return {
      action: "ignored",
      findingCount: matched.length,
      linear: "not_required",
      sentryResolved: 0,
      status: "skipped",
    };
  }

  let smoke: SmokeResult;
  try {
    smoke = await deps.smoke(event.sha);
  } catch {
    return failureResult({
      action: "smoke_failed",
      deps,
      event,
      findingCount: matched.length,
      message: `Production health smoke failed for deployed health SHA ${event.sha}; findings remain unresolved.`,
      now,
      sourceRunId,
      workflowUrl,
    });
  }

  const confirmationData: Record<string, JsonValue> = {
    deployment_environment: event.environment,
    deployment_sha: event.sha,
    deployment_url: event.url,
    health_checked_at: smoke.checkedAt,
    health_status: smoke.body.status,
    health_url: smoke.url,
    http_status: smoke.httpStatus,
  };
  for (const row of matched) {
    await deps.transition({
      confirmationData,
      deployedAt: smoke.checkedAt,
      expectedStatus: "merged",
      id: row.id,
      newStatus: "deployed",
    });
  }
  for (const row of matched) {
    await deps.transition({
      confirmationData,
      expectedStatus: "deployed",
      id: row.id,
      newStatus: "fixed",
    });
  }

  let sentryResolved = 0;
  let sentryFailure = false;
  const issueIds = explicitSentryIds(matched);
  try {
    sentryResolved = await deps.resolveSentry(issueIds);
  } catch {
    sentryFailure = true;
  }
  const message = `Confirmed health PR deployment ${event.sha}: ${matched.length} finding(s) fixed after production smoke.`;
  const delivery = await deliverIndependently(
    deps,
    {
      ...(sentryFailure
        ? { failures: ["Sentry resolution failed after confirmed deployment."] }
        : {}),
      prOutcomes: [message],
    },
    envelope({
      action: "deployment_confirmed",
      event,
      findingCount: matched.length,
      now,
      sourceRunId,
      status: sentryFailure ? "failed" : "success",
      tickets: [],
      verdict: sentryFailure
        ? `${message} Sentry resolution failed and requires retry.`
        : message,
      workflowUrl,
    }),
  );
  return {
    action: "deployment_confirmed",
    delivery,
    findingCount: matched.length,
    linear: "not_required",
    sentryResolved,
    status: sentryFailure || isDeliveryFailure(delivery) ? "failed" : "success",
  };
}

function queueRow(value: unknown): HealthFixRow {
  const row = requiredRecord(value, "health fix row");
  const source = requiredString(row.source, "health fix source");
  const mergePolicy = requiredString(
    row.merge_policy,
    "health fix merge policy",
  );
  const status = requiredString(row.status, "health fix status");
  if (!(["directory", "link", "sentry"] as const).includes(source as never)) {
    throw new Error("health fix source is invalid");
  }
  if (!(mergePolicy === "automatic" || mergePolicy === "human")) {
    throw new Error("health fix merge policy is invalid");
  }
  if (
    !(
      [
        "pr_opened",
        "awaiting_human",
        "merged",
        "deployed",
        "fixed",
        "failed",
        "needs_human",
      ] as const
    ).includes(status as never)
  ) {
    throw new Error("health fix status is invalid");
  }
  return {
    evidence: isRecord(row.evidence)
      ? (row.evidence as Record<string, JsonValue>)
      : {},
    fingerprint: requiredString(row.fingerprint, "health fix fingerprint"),
    id: requiredString(row.id, "health fix id"),
    merge_policy: mergePolicy,
    merge_sha: optionalString(row.merge_sha),
    pr_number:
      row.pr_number === null || row.pr_number === undefined
        ? null
        : requiredInteger(row.pr_number, "health fix pr_number"),
    sentry_issue_id: optionalString(row.sentry_issue_id),
    source,
    status,
    title: requiredString(row.title, "health fix title"),
  } as HealthFixRow;
}

function requiredEnvironment(name: string): string {
  return requiredString(process.env[name], name);
}

function supabaseHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/json",
    apikey: token,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function readQueueRows(
  event: ConfirmationEvent | null,
  fetchImpl: typeof fetch,
): Promise<HealthFixRow[]> {
  if (!event) return [];
  if (
    event.kind === "deployment_status" &&
    !isTrustedRailwayDeployment(event)
  ) {
    return [];
  }
  const baseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const token = requiredEnvironment("HEALTH_AGENT_READER_TOKEN");
  const url = new URL("/rest/v1/health_fix_queue", baseUrl);
  url.searchParams.set(
    "select",
    "id,source,fingerprint,evidence,merge_policy,title,sentry_issue_id,status,pr_number,merge_sha",
  );
  if (event.kind === "pull_request_closed") {
    url.searchParams.set("pr_number", `eq.${event.number}`);
    url.searchParams.set("status", "in.(pr_opened,awaiting_human)");
  } else {
    url.searchParams.set("status", "eq.merged");
  }
  const response = await fetchImpl(url, {
    headers: supabaseHeaders(token),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Health queue read failed");
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error("Health queue response is invalid");
  return body.map(queueRow);
}

function runtimeDependencies(
  audit: AuditRecord[],
  fetchImpl: typeof fetch,
): ConfirmationDependencies {
  const auditLogger = (record: AuditRecord) => audit.push(record);
  return {
    agentHub: (confirmationEnvelope) =>
      delegateToAgentHub(confirmationEnvelope, {
        audit: auditLogger,
        runner: async (payload) => {
          const response = await fetchImpl(
            requiredEnvironment("AGENT_HUB_INGEST_URL"),
            {
              body: JSON.stringify(payload),
              headers: {
                Authorization: `Bearer ${requiredEnvironment("AGENT_HUB_INGEST_TOKEN")}`,
                "Content-Type": "application/json",
              },
              method: "POST",
              signal: AbortSignal.timeout(15_000),
            },
          );
          if (!response.ok) throw new Error("Agent Hub request failed");
          const body: unknown = await response.json();
          if (
            !isRecord(body) ||
            typeof body.duplicate !== "boolean" ||
            typeof body.run_id !== "string"
          ) {
            throw new Error("Agent Hub response is invalid");
          }
          return body;
        },
      }),
    linear: async (rows) => {
      const findings: HealthFinding[] = rows.map((row) => ({
        evidence: row.evidence,
        fingerprint: row.fingerprint,
        humanReason: "Health repair PR closed without merge",
        mergePolicy: "human",
        sentryIssueId: row.sentry_issue_id ?? undefined,
        severity: "high",
        source: row.source,
        title: row.title,
      }));
      const result = await syncLinearFindings(
        {
          exhaustedAutomationFingerprints: findings.map(
            (finding) => finding.fingerprint,
          ),
          findings,
        },
        {
          assigneeId: requiredEnvironment("LINEAR_ASSIGNEE_ID"),
          audit: auditLogger,
          oauthAccessToken: requiredEnvironment("LINEAR_OAUTH_ACCESS_TOKEN"),
          projectId: requiredEnvironment("LINEAR_PROJECT_ID"),
          teamId: requiredEnvironment("LINEAR_TEAM_ID"),
        },
      );
      return {
        tickets: result.outcomes
          .map((outcome) => outcome.identifier)
          .filter((value): value is string => Boolean(value)),
      };
    },
    resolveSentry: (issueIds) =>
      resolveSentryIssues(issueIds, {
        audit: auditLogger,
        baseUrl: requiredEnvironment("SENTRY_BASE_URL"),
        resolveToken: requiredEnvironment("SENTRY_RESOLVER_TOKEN"),
      }),
    slack: (report) =>
      sendSlackDigest(report, {
        audit: auditLogger,
        webhookUrl: requiredEnvironment("SLACK_HEALTH_WEBHOOK_URL"),
      }),
    smoke: async () => {
      const url = new URL(
        "/api/health",
        requiredEnvironment("FORMORIA_RAILWAY_URL"),
      ).toString();
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(body) || body.status !== "ok") {
        throw new Error("Production health smoke failed");
      }
      return {
        body: { status: "ok" },
        checkedAt: new Date().toISOString(),
        httpStatus: response.status,
        url,
      };
    },
    transition: async (input) => {
      const baseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
      const token = requiredEnvironment("HEALTH_AGENT_WRITER_TOKEN");
      const response = await fetchImpl(
        new URL("/rest/v1/rpc/transition_health_fix", baseUrl),
        {
          body: JSON.stringify({
            p_confirmation_data: input.confirmationData ?? null,
            p_deployed_at: input.deployedAt ?? null,
            p_expected_status: input.expectedStatus,
            p_id: input.id,
            p_last_error: input.lastError ?? null,
            p_merge_sha: input.mergeSha ?? null,
            p_new_status: input.newStatus,
            p_next_attempt_at: null,
            p_pr_number: input.prNumber ?? null,
            p_pr_url: input.prUrl ?? null,
          }),
          headers: supabaseHeaders(token),
          method: "POST",
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) throw new Error("Health queue transition RPC failed");
      return queueRow(await response.json());
    },
  };
}

export async function main(): Promise<void> {
  const eventPath = requiredEnvironment("GITHUB_EVENT_PATH");
  const eventName = requiredEnvironment("GITHUB_EVENT_NAME");
  const payload: unknown = JSON.parse(await readFile(eventPath, "utf8"));
  const event = parseConfirmationEvent(eventName, payload);
  const audit: AuditRecord[] = [];
  const rows = await readQueueRows(event, fetch);
  const result = await confirmHealthEvent({
    dependencies: runtimeDependencies(audit, fetch),
    event,
    rows,
    sourceRunId: requiredEnvironment("HEALTH_CONFIRMATION_SOURCE_RUN_ID"),
    workflowUrl: process.env.HEALTH_CONFIRMATION_WORKFLOW_URL,
  });
  const auditPath = requiredEnvironment("HEALTH_CONFIRMATION_AUDIT_PATH");
  await writeFile(
    auditPath,
    `${JSON.stringify({ audit, result }, null, 2)}\n`,
    "utf8",
  );
  console.log(
    JSON.stringify({ event: "health_confirmation_complete", ...result }),
  );
  if (result.status === "failed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : "unknown_failure",
        event: "health_confirmation_failed",
      }),
    );
    process.exitCode = 1;
  });
}
