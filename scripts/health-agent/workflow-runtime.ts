import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  createAgentHubAdapter,
  createLinearAdapter,
  sendSlackDigest,
  type AgentHubAdapter,
  type SlackReport,
} from "./adapters";
import {
  evaluateDirectoryHealth,
  evaluateLinkTelemetry,
  type DependabotAlertEvidence,
  type DirectoryHealthInput,
  type LinkTelemetryRecord,
  type StaleBranchEvidence,
} from "./directory";
import {
  buildSentryHealthFinding,
  collectSentryIssues,
  sanitizeSentryIssue,
  SentryClassificationSchema,
  type SanitizedSentryIssue,
  type SentryClassification,
} from "./sentry";
import {
  buildRepairBranchName,
  partitionRepairBatch,
  redactEvidenceArtifactReference,
  snapshotClaimedFindings,
  type RepairFinding,
  type RepairPartition,
  type RepairSnapshot,
} from "./repair";
import {
  aggregateAndDeliver,
  buildPrResultEnvelope,
  buildLinkHealthRequest,
  collectDirectoryArtifact,
  enqueueAndClaimBatch,
  executeLinkHealthRequest,
  failedCollectorArtifact,
  loadCollectorArtifact,
  readBoundedJson,
  redactForAudit,
  taipeiDate,
  validateCollectorArtifact,
  writeRedactedJson,
  type AggregateResult,
  type ArtifactFileSystem,
  type DirectoryCollectionProvider,
  type HealthAgentDependencies,
  type HealthCollectorArtifact,
  type JsonFileStore,
  type QueueBatchResult,
  type SlackDigestInput,
} from "./orchestrator";
import type {
  AuditLogger,
  AuditRecord,
  HealthFinding,
  JsonValue,
} from "./contracts";

const MAX_RUNTIME_FINDINGS = 10_000;
const MAX_RUNTIME_ISSUES = 20;
const execFileAsync = promisify(execFile);
const ACTIVE_AUTOMATIC_STATUSES = [
  "pending",
  "claimed",
  "pr_opened",
  "awaiting_human",
  "merged",
  "deployed",
  "failed",
] as const;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;
type RuntimeFiles = JsonFileStore | ArtifactFileSystem;
type JsonObject = Record<string, JsonValue>;

export const WORKFLOW_RUNTIME_COMMANDS = [
  "collect-link",
  "collect-directory-evidence",
  "collect-sentry",
  "classify-sentry",
  "combine-sentry",
  "evaluate-directory",
  "aggregate-and-deliver",
  "enqueue-and-claim",
  "repair-snapshot",
  "repair-metadata",
  "repair-audit",
  "repair-result",
] as const;

export type WorkflowRuntimeCommand =
  | (typeof WORKFLOW_RUNTIME_COMMANDS)[number]
  | "link-collect"
  | "directory-evidence"
  | "sentry-classify-combine"
  | "directory-collect"
  | "enqueue-claim-batch"
  | "prepare-repair-snapshot"
  | "prepare-repair-metadata"
  | "prepare-repair-audit";

export interface WorkflowRuntimeDependencies extends HealthAgentDependencies {
  auditRecords?: AuditRecord[];
  fetchImplementation?: typeof fetch;
  isAncestor?: (tipSha: string, mainSha: string) => Promise<boolean>;
}

export interface RuntimeDependencyOptions {
  audit?: AuditLogger;
  auditRecords?: AuditRecord[];
  env?: RuntimeEnvironment;
  fetchImplementation?: typeof fetch;
  files?: JsonFileStore;
}

export interface SanitizedSentryArtifact {
  candidateIssueCount: number;
  classificationsRequired: number;
  hasMore: boolean;
  incidentMode: boolean;
  issues: SanitizedSentryIssue[];
  requestCount: number;
  status?: "failed" | "success";
  version: 1;
}

export interface SentryClassificationArtifact {
  classifications: SentryClassification[];
  status: "failed" | "success";
  version: 1;
}

export interface LinkCollectInput {
  inputPath?: string;
  mode: "canary_fix" | "live" | "preflight";
  outputPath: string;
  runAt?: string;
  workflowAttempt: number;
  workflowRunId: string;
}

export interface SentryCollectInput {
  mode: "canary_fix" | "live" | "preflight";
  outputPath: string;
}

export interface SentryClassifyInput {
  inputPath: string;
  outputPath: string;
}

export interface SentryCombineInput {
  classificationsPath: string;
  issuesPath: string;
  mode: "canary_fix" | "live" | "preflight";
  outputPath: string;
  runAt?: string;
}

export interface DirectoryEvaluateInput {
  evidencePath: string;
  linkArtifactPath: string;
  mode: "canary_fix" | "live" | "preflight";
  outputPath: string;
  runAt: string;
}

export interface DirectoryEvidenceCollectInput {
  inputPath?: string;
  linkArtifactPath?: string;
  outputPath: string;
}

export interface AggregateWorkflowInput {
  auditPath?: string;
  directoryArtifactPath: string;
  exhaustedAutomationFingerprints?: readonly string[];
  linkArtifactPath: string;
  mode: "canary_fix" | "live" | "preflight";
  outputPath: string;
  prOutcomes?: readonly JsonValue[];
  runAt: string;
  sentryArtifactPath: string;
  workflowAttempt: number;
  workflowRunId: string;
}

export interface QueueWorkflowInput {
  canaryFingerprints?: readonly string[];
  findingsArtifactPath: string;
  leaseOwner: string;
  mode: "canary_fix" | "live" | "preflight";
  outputPath: string;
}

export interface RepairSnapshotInput {
  batchKind?: "automatic" | "human";
  inputPath: string;
  outputPath: string;
}

export interface RepairMetadataInput {
  outputPath: string;
  snapshotPath: string;
}

export interface RepairAuditInput {
  metadataPath?: string;
  outputPath: string;
  resultPath?: string;
  snapshotPath: string;
}

export interface RepairResultInput {
  autoMergeEnabled: boolean;
  leaseOwner: string;
  mergePolicy: "automatic" | "human";
  metadataPath: string;
  outputPath: string;
  prNumber: number;
  prUrl: string;
  runAt: string;
  workflowAttempt: number;
  workflowRunId: string;
}

export interface LinkHealthSummaryInput {
  blocked: number;
  broken: number;
  checked: number;
  cleanupRequired: readonly {
    brandId: string;
    field: string;
    url: string;
  }[];
  failingRows: readonly Record<string, unknown>[];
  heroBroken: readonly Record<string, unknown>[];
  heroExternal: readonly Record<string, unknown>[];
  ok: number;
  severity: string;
}

export interface SentryCollectionInput {
  candidateIssueCount: number;
  hasMore: boolean;
  incidentMode: boolean;
  issues: readonly SanitizedSentryIssue[];
  requestCount: number;
}

const nativeFiles: ArtifactFileSystem = {
  readFile: (path) => readFile(path, "utf8"),
  writeFile: (path, contents) => writeFile(path, contents, "utf8"),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectValue(value: unknown): JsonObject {
  const safe = redactForAudit(value);
  return isRecord(safe) ? (safe as JsonObject) : {};
}

function filesFor(dependencies: WorkflowRuntimeDependencies): RuntimeFiles {
  return dependencies.files ?? dependencies.fileSystem ?? nativeFiles;
}

function environmentFor(
  dependencies: WorkflowRuntimeDependencies,
): RuntimeEnvironment {
  return dependencies.env ?? process.env;
}

function fetchFor(dependencies: WorkflowRuntimeDependencies): typeof fetch {
  return dependencies.fetchImplementation ?? fetch;
}

function requiredEnvironment(
  environment: RuntimeEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error("required_runtime_environment");
  return value;
}

function optionalEnvironment(
  environment: RuntimeEnvironment,
  name: string,
): string | undefined {
  const value = environment[name]?.trim();
  return value || undefined;
}

function safeMode(value: unknown): LinkCollectInput["mode"] {
  if (value === "preflight" || value === "live" || value === "canary_fix") {
    return value;
  }
  throw new Error("invalid_runtime_mode");
}

function safeString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || !field.trim()) {
    throw new Error("invalid_runtime_input");
  }
  return value.trim();
}

function safeAttempt(value: unknown): number {
  const attempt = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error("invalid_runtime_attempt");
  }
  return attempt;
}

function safeAuditRecord(record: AuditRecord): AuditRecord {
  return {
    ...record,
    request: objectValue(record.request),
    response: objectValue(record.response),
  };
}

function requestArguments(body: BodyInit | null | undefined): JsonValue {
  if (body === null || body === undefined) return {};
  if (typeof body !== "string") return redactForAudit(String(body));
  try {
    return redactForAudit(JSON.parse(body) as unknown);
  } catch {
    return redactForAudit(body);
  }
}

export function createWorkflowAudit(records: AuditRecord[] = []): {
  audit: AuditLogger;
  records: AuditRecord[];
} {
  return {
    audit: (record) => records.push(safeAuditRecord(record)),
    records,
  };
}

export async function writeAuditArtifact(
  outputPath: string,
  records: readonly AuditRecord[],
  files: RuntimeFiles = nativeFiles,
): Promise<void> {
  await writeRedactedJson(
    outputPath,
    {
      records: records.map(safeAuditRecord),
      version: 1,
    },
    files,
  );
}

function auditFor(dependencies: WorkflowRuntimeDependencies): AuditLogger {
  if (dependencies.audit) return dependencies.audit;
  const records = dependencies.auditRecords ?? [];
  return createWorkflowAudit(records).audit;
}

function signal(timeoutMs: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
}

async function jsonResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function supabaseRequest(
  dependencies: WorkflowRuntimeDependencies,
  operation: string,
  path: string,
  tokenName: string,
  init: RequestInit,
  validate: (value: unknown) => boolean,
): Promise<unknown> {
  const environment = environmentFor(dependencies);
  const token = requiredEnvironment(environment, tokenName);
  const baseUrl = requiredEnvironment(environment, "NEXT_PUBLIC_SUPABASE_URL");
  const url = new URL(path, baseUrl).toString();
  const audit = auditFor(dependencies);
  const startedAt = performance.now();
  const headers = {
    Accept: "application/json",
    apikey: token,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
  };
  try {
    const response = await fetchFor(dependencies)(url, {
      ...init,
      headers,
      signal: init.signal ?? signal(15_000),
    });
    const body = await jsonResponse(response);
    const schemaValid = response.ok && validate(body);
    audit({
      adapter: "supabase-runtime",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      operation,
      request: {
        arguments: requestArguments(init.body),
        method: init.method ?? "GET",
        resource: path,
      },
      response: {
        httpStatus: response.status,
        result: objectValue(body),
      },
      schemaValid,
      status: schemaValid ? "success" : "failure",
    });
    if (!schemaValid) throw new Error("supabase_runtime_request_failed");
    return body;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "supabase_runtime_request_failed"
    ) {
      throw error;
    }
    audit({
      adapter: "supabase-runtime",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      operation,
      request: {
        arguments: requestArguments(init.body),
        method: init.method ?? "GET",
        resource: path,
      },
      response: { error: "request_failed" },
      schemaValid: false,
      status: "failure",
    });
    throw new Error("supabase_runtime_request_failed");
  }
}

const HEALTH_AGENT_RPC_NAMES = new Set([
  "claim_health_agent_run",
  "claim_health_fixes",
  "complete_health_agent_run",
  "enqueue_health_fix",
  "fail_health_agent_run",
  "record_health_snapshot",
  "record_link_health_result",
  "transition_health_fix",
]);

export interface RpcClientOptions {
  audit?: AuditLogger;
  baseUrl: string;
  token: string;
}

export interface RpcClient {
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export function createRpcClient(
  options: RpcClientOptions,
  fetchImplementation: typeof fetch = fetch,
): RpcClient {
  const baseUrl = new URL(options.baseUrl);
  if (!/^https?:$/.test(baseUrl.protocol) || !options.token.trim()) {
    throw new Error("rpc_client_configuration_invalid");
  }
  return {
    call: async (name, args) => {
      if (!HEALTH_AGENT_RPC_NAMES.has(name)) {
        throw new Error("rpc_endpoint_not_allowed");
      }
      const startedAt = performance.now();
      const url = new URL(`/rest/v1/rpc/${name}`, baseUrl).toString();
      try {
        const response = await fetchImplementation(url, {
          body: JSON.stringify(args),
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${options.token}`,
            "Content-Type": "application/json",
            apikey: options.token,
          },
          method: "POST",
          signal: signal(15_000),
        });
        const body = await jsonResponse(response);
        const schemaValid = response.ok;
        options.audit?.({
          adapter: "supabase-rpc",
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          operation: name,
          request: { arguments: redactForAudit(args), endpoint: name },
          response: {
            httpStatus: response.status,
            result: objectValue(body),
          },
          schemaValid,
          status: schemaValid ? "success" : "failure",
        });
        if (!schemaValid) throw new Error("rpc_request_failed");
        return body;
      } catch (error) {
        if (error instanceof Error && error.message === "rpc_request_failed") {
          throw error;
        }
        options.audit?.({
          adapter: "supabase-rpc",
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          operation: name,
          request: { arguments: redactForAudit(args), endpoint: name },
          response: { error: "request_failed" },
          schemaValid: false,
          status: "failure",
        });
        throw new Error("rpc_request_failed");
      }
    },
  };
}

function supabaseQueueDependencies(
  dependencies: WorkflowRuntimeDependencies,
): NonNullable<HealthAgentDependencies["queue"]> {
  return {
    claim: async (policy, leaseOwner) => {
      const value = await supabaseRequest(
        dependencies,
        "claim_health_fixes",
        "/rest/v1/rpc/claim_health_fixes",
        "HEALTH_AGENT_WRITER_TOKEN",
        {
          body: JSON.stringify({
            p_lease_duration: "30 minutes",
            p_lease_owner: leaseOwner,
            p_merge_policy: policy,
          }),
          method: "POST",
        },
        (candidate) => Array.isArray(candidate),
      );
      return (value as unknown[]).filter(isRecord).map(repairFindingFromValue);
    },
    enqueue: async (entry) => {
      await supabaseRequest(
        dependencies,
        "enqueue_health_fix",
        "/rest/v1/rpc/enqueue_health_fix",
        "HEALTH_AGENT_WRITER_TOKEN",
        {
          body: JSON.stringify({
            p_evidence: entry.evidence,
            p_fingerprint: entry.fingerprint,
            p_merge_policy: entry.mergePolicy,
            p_sentry_issue_id: entry.sentryIssueId ?? null,
            p_source: entry.source,
            p_title: entry.title,
            p_url: null,
          }),
          method: "POST",
        },
        (candidate) =>
          typeof candidate === "string" ||
          (Array.isArray(candidate) && candidate.length <= 1),
      );
    },
    hasUnconfirmedAutomatic: async () => {
      const params = new URLSearchParams({
        merge_policy: "eq.automatic",
        select: "id",
        status: `in.(${ACTIVE_AUTOMATIC_STATUSES.join(",")})`,
      });
      const value = await supabaseRequest(
        dependencies,
        "check_unconfirmed_automatic_health_fixes",
        `/rest/v1/health_fix_queue?${params.toString()}`,
        "HEALTH_AGENT_READER_TOKEN",
        { method: "GET" },
        (candidate) => Array.isArray(candidate),
      );
      return (value as unknown[]).length > 0;
    },
  };
}

function recordRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isDirectoryHealthInput(value: unknown): value is DirectoryHealthInput {
  return (
    isRecord(value) &&
    isRecord(value.approvedBrands) &&
    Array.isArray(value.links) &&
    isRecord(value.database) &&
    Array.isArray(value.dependabot) &&
    Array.isArray(value.branches) &&
    typeof value.nowIso === "string"
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function supabaseRows(
  dependencies: WorkflowRuntimeDependencies,
  resource: string,
  select: string,
  operation: string,
  filters: Readonly<Record<string, string>> = {},
): Promise<Record<string, unknown>[]> {
  const query = new URLSearchParams({ order: "id", select, ...filters });
  return recordRows(
    await supabaseRequest(
      dependencies,
      operation,
      `/rest/v1/${resource}?${query.toString()}`,
      "HEALTH_AGENT_READER_TOKEN",
      { method: "GET" },
      (value) => Array.isArray(value),
    ),
  );
}

function linkRecordsFromArtifact(
  artifact: HealthCollectorArtifact,
): LinkTelemetryRecord[] {
  const telemetry = isRecord(artifact.snapshot?.telemetry)
    ? artifact.snapshot.telemetry
    : undefined;
  const records =
    telemetry && Array.isArray(telemetry.records) ? telemetry.records : [];
  return records.flatMap((value): LinkTelemetryRecord[] => {
    if (!isRecord(value)) return [];
    const recordId = stringValue(value.recordId);
    const brandId = stringValue(value.brandId);
    const field = stringValue(value.field);
    if (!recordId || !brandId || !field) return [];
    return [
      {
        brandId,
        failureDates: stringArray(value.failureDates),
        field,
        internalStorage: value.internalStorage === true,
        recordId,
        statusCode:
          typeof value.statusCode === "number" ? value.statusCode : null,
        target: value.target === "image" ? "image" : "link",
      },
    ];
  });
}

function linkRecordsFromRows(
  rows: readonly Record<string, unknown>[],
): LinkTelemetryRecord[] {
  return rows.flatMap((row): LinkTelemetryRecord[] => {
    const recordId = stringValue(row.id ?? row.record_id);
    const brandId = stringValue(row.brand_id ?? row.brandId);
    const field = stringValue(row.field);
    if (!recordId || !brandId || !field) return [];
    return [
      {
        brandId,
        failureDates: stringArray(row.failure_dates ?? row.failureDates),
        field,
        internalStorage: row.internal_storage === true,
        recordId,
        statusCode:
          typeof row.last_status_code === "number"
            ? row.last_status_code
            : typeof row.statusCode === "number"
              ? row.statusCode
              : null,
        target: field === "hero_image_url" ? "image" : "link",
      },
    ];
  });
}

function directoryDatabaseEvidence(
  rows: readonly Record<string, unknown>[],
): DirectoryHealthInput["database"] {
  const metricRows = rows.map((row) =>
    isRecord(row.metrics) ? row.metrics : row,
  );
  const metrics = metricRows.at(-1) ?? {};
  const database = isRecord(metrics.database) ? metrics.database : metrics;
  const connections = isRecord(database.connections)
    ? database.connections
    : {};
  const activeQueries = Array.isArray(database.activeQueries)
    ? database.activeQueries.filter(isRecord)
    : [];
  const deadTupleSnapshots = metricRows.flatMap((metricRow) => {
    const candidate = isRecord(metricRow.database)
      ? metricRow.database
      : metricRow;
    return Array.isArray(candidate.deadTupleSnapshots)
      ? candidate.deadTupleSnapshots.filter(isRecord)
      : [];
  });
  const indexConcerns = Array.isArray(database.indexConcerns)
    ? database.indexConcerns.filter(isRecord)
    : [];
  return {
    activeQueries: activeQueries.flatMap((value) => {
      const queryId = stringValue(value.queryId ?? value.query_id);
      return queryId
        ? [
            {
              durationSeconds: numberValue(
                value.durationSeconds ?? value.duration_seconds,
              ),
              queryId,
            },
          ]
        : [];
    }),
    connections: {
      maximum: numberValue(
        connections.maximum ??
          connections.maxConnections ??
          connections.max_connections,
      ),
      total: numberValue(
        connections.total ??
          connections.totalConnections ??
          connections.total_connections,
      ),
    },
    deadTupleSnapshots: deadTupleSnapshots.flatMap((value) => {
      const snapshotDate = stringValue(
        value.snapshotDate ?? value.snapshot_date,
      );
      const tables = Array.isArray(value.tables)
        ? value.tables.filter(isRecord).flatMap((table) => {
            const tableName = stringValue(table.tableName ?? table.table_name);
            return tableName
              ? [
                  {
                    deadTuplePercent: numberValue(
                      table.deadTuplePercent ?? table.dead_tuple_percent,
                    ),
                    tableName,
                  },
                ]
              : [];
          })
        : [];
      return snapshotDate ? [{ snapshotDate, tables }] : [];
    }),
    indexConcerns: indexConcerns.flatMap((value) => {
      const concernId = stringValue(value.concernId ?? value.concern_id);
      const tableName = stringValue(value.tableName ?? value.table_name);
      const queryFingerprint = stringValue(
        value.queryFingerprint ?? value.query_fingerprint,
      );
      const indexName = stringValue(value.indexName ?? value.index_name);
      const planEvidence = stringValue(
        value.planEvidence ?? value.plan_evidence,
      );
      return concernId &&
        tableName &&
        queryFingerprint &&
        indexName &&
        planEvidence
        ? [{ concernId, indexName, planEvidence, queryFingerprint, tableName }]
        : [];
    }),
  };
}

function approvedBrandInput(
  rows: readonly Record<string, unknown>[],
  nowIso: string,
): DirectoryHealthInput["approvedBrands"] {
  const today = taipeiDate(nowIso);
  const gaps = rows.flatMap((row) => {
    const brandId = stringValue(row.id);
    return brandId
      ? [
          {
            brandId,
            descriptionTooShort:
              (stringValue(row.description)?.length ?? 0) < 20,
            missingApprovedAt: !stringValue(row.approved_at ?? row.approvedAt),
            missingHeroImage: !stringValue(
              row.hero_image_url ?? row.heroImageUrl,
            ),
          },
        ]
      : [];
  });
  return {
    addedToday: rows.filter((row) => {
      const createdAt = stringValue(row.created_at ?? row.createdAt);
      return createdAt ? taipeiDate(createdAt) === today : false;
    }).length,
    gaps,
    totalApproved: rows.length,
  };
}

const DIRECTORY_GITHUB_QUERY = `
  query DirectoryHealth($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef { name target { ... on Commit { oid } } }
      refs(refPrefix: "refs/heads/", first: 100) {
        nodes {
          name
          branchProtectionRule { id }
          target { ... on Commit { oid committedDate } }
          associatedPullRequests(first: 20, states: [OPEN, MERGED]) {
            nodes { state mergedAt headRefOid }
          }
        }
      }
      vulnerabilityAlerts(first: 100, states: OPEN) {
        nodes {
          number
          securityVulnerability {
            severity
            package { name }
            firstPatchedVersion { identifier }
          }
        }
      }
    }
  }
`;

async function tipIsAncestorOfMain(
  tipSha: string,
  mainSha: string,
): Promise<boolean> {
  try {
    await execFileAsync("git", [
      "merge-base",
      "--is-ancestor",
      tipSha,
      mainSha,
    ]);
    return true;
  } catch {
    return false;
  }
}

function versionImpact(
  value: unknown,
): DependabotAlertEvidence["versionImpact"] {
  const identifier = stringValue(value);
  if (!identifier) return "unknown";
  const parts = identifier.replace(/^v/i, "").split(".");
  if (parts.length < 3 || parts.some((part) => !/^\d+/.test(part))) {
    return "unknown";
  }
  return Number(parts[0]) === 0 ? "minor" : "unknown";
}

export async function collectGitHubDirectoryEvidence(
  dependencies: WorkflowRuntimeDependencies,
): Promise<{
  branches: StaleBranchEvidence[];
  dependabot: DependabotAlertEvidence[];
}> {
  const environment = environmentFor(dependencies);
  const repository = requiredEnvironment(environment, "GITHUB_REPOSITORY");
  const [owner, name, extra] = repository.split("/");
  if (!owner || !name || extra) throw new Error("github_repository_invalid");
  const startedAt = performance.now();
  const response = await fetchFor(dependencies)(
    "https://api.github.com/graphql",
    {
      body: JSON.stringify({
        query: DIRECTORY_GITHUB_QUERY,
        variables: { name, owner },
      }),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${requiredEnvironment(environment, "GITHUB_TOKEN")}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      method: "POST",
      signal: signal(20_000),
    },
  );
  const body = await jsonResponse(response);
  const repositoryData =
    isRecord(body) && isRecord(body.data) && isRecord(body.data.repository)
      ? body.data.repository
      : undefined;
  const schemaValid = response.ok && repositoryData !== undefined;
  auditFor(dependencies)({
    adapter: "github-directory-evidence",
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    operation: "collect_directory_evidence",
    request: { repository },
    response: { httpStatus: response.status, schemaValid },
    schemaValid,
    status: schemaValid ? "success" : "failure",
  });
  if (!repositoryData) throw new Error("github_directory_evidence_invalid");

  const defaultBranch = isRecord(repositoryData.defaultBranchRef)
    ? repositoryData.defaultBranchRef
    : {};
  const defaultBranchName = stringValue(defaultBranch.name);
  const defaultTarget = isRecord(defaultBranch.target)
    ? defaultBranch.target
    : {};
  const mainSha = stringValue(defaultTarget.oid);
  if (!defaultBranchName || !mainSha) {
    throw new Error("github_default_branch_invalid");
  }

  const refs =
    isRecord(repositoryData.refs) && Array.isArray(repositoryData.refs.nodes)
      ? repositoryData.refs.nodes.filter(isRecord)
      : [];
  const branches = await Promise.all(
    refs.map(async (ref): Promise<StaleBranchEvidence | null> => {
      const branchRef = stringValue(ref.name);
      const target = isRecord(ref.target) ? ref.target : {};
      const tipSha = stringValue(target.oid);
      const lastCommitAt = stringValue(target.committedDate);
      if (!branchRef || !tipSha || !lastCommitAt) return null;
      const pullRequests =
        isRecord(ref.associatedPullRequests) &&
        Array.isArray(ref.associatedPullRequests.nodes)
          ? ref.associatedPullRequests.nodes.filter(isRecord)
          : [];
      const openPullRequest = pullRequests.some(
        (pull) => pull.state === "OPEN",
      );
      const merged = pullRequests.some(
        (pull) =>
          pull.state === "MERGED" &&
          typeof pull.mergedAt === "string" &&
          pull.headRefOid === tipSha,
      );
      return {
        branchRef,
        currentMainSha: mainSha,
        currentRemoteTipSha: tipSha,
        defaultBranch: branchRef === defaultBranchName,
        lastCommitAt,
        merged,
        observedTipSha: tipSha,
        openPullRequest,
        protectedBranch: isRecord(ref.branchProtectionRule),
        tipIsAncestorOfMain: await (
          dependencies.isAncestor ?? tipIsAncestorOfMain
        )(tipSha, mainSha),
      };
    }),
  );

  const alerts =
    isRecord(repositoryData.vulnerabilityAlerts) &&
    Array.isArray(repositoryData.vulnerabilityAlerts.nodes)
      ? repositoryData.vulnerabilityAlerts.nodes.filter(isRecord)
      : [];
  const dependabot = alerts.flatMap((alert): DependabotAlertEvidence[] => {
    const vulnerability = isRecord(alert.securityVulnerability)
      ? alert.securityVulnerability
      : {};
    const packageValue = isRecord(vulnerability.package)
      ? vulnerability.package
      : {};
    const severity = stringValue(vulnerability.severity)?.toLowerCase();
    const packageName = stringValue(packageValue.name);
    const alertId =
      typeof alert.number === "number" ? String(alert.number) : undefined;
    if (
      !alertId ||
      !packageName ||
      (severity !== "low" &&
        severity !== "medium" &&
        severity !== "high" &&
        severity !== "critical")
    ) {
      return [];
    }
    const patched = isRecord(vulnerability.firstPatchedVersion)
      ? vulnerability.firstPatchedVersion.identifier
      : undefined;
    return [
      {
        alertId,
        packageName,
        severity,
        state: "open",
        versionImpact: versionImpact(patched),
      },
    ];
  });
  return {
    branches: branches.filter(
      (branch): branch is StaleBranchEvidence => branch !== null,
    ),
    dependabot,
  };
}

async function defaultDirectoryCollector(
  dependencies: WorkflowRuntimeDependencies,
  linkArtifact: HealthCollectorArtifact,
): Promise<DirectoryHealthInput> {
  const nowIso = new Date().toISOString();
  const [brands, storedLinks, snapshots, currentDatabase, github] =
    await Promise.all([
      supabaseRows(
        dependencies,
        "brands",
        "id,created_at,hero_image_url,description,approved_at",
        "read_approved_brands",
        { status: "eq.approved" },
      ),
      supabaseRows(
        dependencies,
        "link_check_results",
        "id,brand_id,field,last_status_code,failure_dates,distinct_failure_days",
        "read_link_telemetry",
      ),
      supabaseRows(
        dependencies,
        "health_snapshots",
        "id,snapshot_date,metrics",
        "read_health_snapshots",
      ).catch(() => []),
      supabaseRequest(
        dependencies,
        "read_health_directory_database_evidence",
        "/rest/v1/rpc/read_health_directory_database_evidence",
        "HEALTH_AGENT_READER_TOKEN",
        { body: "{}", method: "POST" },
        (value) => isRecord(value),
      ),
      collectGitHubDirectoryEvidence(dependencies),
    ]);
  const artifactLinks = linkRecordsFromArtifact(linkArtifact);
  const approvedBrandIds = new Set(
    brands.flatMap((brand) => {
      const id = stringValue(brand.id);
      return id ? [id] : [];
    }),
  );
  const links = (
    artifactLinks.length > 0 ? artifactLinks : linkRecordsFromRows(storedLinks)
  ).filter((link) => approvedBrandIds.has(link.brandId));
  return {
    approvedBrands: approvedBrandInput(brands, nowIso),
    branches: github.branches,
    database: directoryDatabaseEvidence([
      ...snapshots,
      { metrics: { database: currentDatabase } },
    ]),
    dependabot: github.dependabot,
    links,
    nowIso,
  };
}

function healthAgentHubDependency(
  dependencies: WorkflowRuntimeDependencies,
): AgentHubAdapter {
  const environment = environmentFor(dependencies);
  const fetchImplementation = fetchFor(dependencies);
  return createAgentHubAdapter({
    audit: auditFor(dependencies),
    runner: async (envelope) => {
      const audit = auditFor(dependencies);
      const startedAt = performance.now();
      const request = { envelope: objectValue(envelope), method: "POST" };
      let response: Response;
      try {
        response = await fetchImplementation(
          requiredEnvironment(environment, "AGENT_HUB_INGEST_URL"),
          {
            body: JSON.stringify(envelope),
            headers: {
              Authorization: `Bearer ${requiredEnvironment(environment, "AGENT_HUB_INGEST_TOKEN")}`,
              "Content-Type": "application/json",
            },
            method: "POST",
            signal: signal(15_000),
          },
        );
      } catch {
        audit({
          adapter: "agent-hub-runtime",
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          operation: "ingest_envelope",
          request,
          response: { error: "request_failed" },
          schemaValid: false,
          status: "failure",
        });
        throw new Error("agent_hub_runtime_request_failed");
      }
      const body = await jsonResponse(response);
      const schemaValid =
        response.ok &&
        isRecord(body) &&
        typeof body.duplicate === "boolean" &&
        typeof body.run_id === "string";
      audit({
        adapter: "agent-hub-runtime",
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        operation: "ingest_envelope",
        request,
        response: {
          httpStatus: response.status,
          result: objectValue(body),
        },
        schemaValid,
        status: schemaValid ? "success" : "failure",
      });
      if (
        !response.ok ||
        !isRecord(body) ||
        typeof body.duplicate !== "boolean" ||
        typeof body.run_id !== "string"
      ) {
        throw new Error("agent_hub_runtime_request_failed");
      }
      return body;
    },
  });
}

export function createWorkflowRuntimeDependencies(
  options: RuntimeDependencyOptions = {},
): WorkflowRuntimeDependencies {
  const records = options.auditRecords ?? [];
  const audit = options.audit ?? createWorkflowAudit(records).audit;
  const dependencies: WorkflowRuntimeDependencies = {
    audit,
    auditRecords: records,
    env: options.env ?? process.env,
    fetchImplementation: options.fetchImplementation ?? fetch,
    files: options.files,
  };

  const directoryCollector: DirectoryCollectionProvider = async ({ link }) =>
    defaultDirectoryCollector(dependencies, link);
  dependencies.collectors = { directory: directoryCollector };

  const agentHub = healthAgentHubDependency(dependencies);
  dependencies.delivery = {
    agentHub: (envelope) => agentHub.report(envelope),
    slack: (report) =>
      sendSlackDigest(report as unknown as SlackReport, {
        audit,
        webhookUrl: requiredEnvironment(
          environmentFor(dependencies),
          "SLACK_HEALTH_WEBHOOK_URL",
        ),
      }),
  };
  dependencies.linear = async (input) => {
    const environment = environmentFor(dependencies);
    const adapter = createLinearAdapter({
      assigneeId: requiredEnvironment(environment, "LINEAR_ASSIGNEE_ID"),
      audit,
      fetchImpl: fetchFor(dependencies),
      oauthAccessToken: requiredEnvironment(
        environment,
        "LINEAR_OAUTH_ACCESS_TOKEN",
      ),
      projectId: requiredEnvironment(environment, "LINEAR_PROJECT_ID"),
      teamId: requiredEnvironment(environment, "LINEAR_TEAM_ID"),
    });
    const result = await adapter.sync(input);
    return {
      outcomes: result.outcomes.map((outcome) => objectValue(outcome)),
      tickets: result.outcomes
        .map((outcome) => outcome.identifier)
        .filter((value): value is string => Boolean(value)),
    };
  };
  dependencies.queue = supabaseQueueDependencies(dependencies);
  return dependencies;
}

function linkTelemetryFromSummary(value: unknown): LinkTelemetryRecord[] {
  if (!isRecord(value) || !Array.isArray(value.failingRows)) return [];
  return value.failingRows.flatMap((candidate): LinkTelemetryRecord[] => {
    if (!isRecord(candidate)) return [];
    const brandId =
      typeof candidate.brandId === "string" ? candidate.brandId : "";
    const field = typeof candidate.field === "string" ? candidate.field : "";
    if (!brandId || !field) return [];
    const failureDates = Array.isArray(candidate.failureDates)
      ? candidate.failureDates.filter(
          (date): date is string => typeof date === "string",
        )
      : [];
    return [
      {
        brandId,
        failureDates,
        field,
        internalStorage: candidate.internalStorage === true,
        recordId:
          typeof candidate.recordId === "string"
            ? candidate.recordId
            : `${brandId}:${field}`,
        statusCode:
          typeof candidate.statusCode === "number"
            ? candidate.statusCode
            : null,
        target: field === "hero_image_url" ? "image" : "link",
      },
    ];
  });
}

export function makeLinkArtifact(
  summary: LinkHealthSummaryInput,
  collectedAt: string,
  mode: LinkCollectInput["mode"] = "live",
): HealthCollectorArtifact {
  const summaryValue = summary as unknown as Record<string, unknown>;
  const telemetry = linkTelemetryFromSummary(summaryValue);
  const evaluated = evaluateLinkTelemetry(telemetry);
  const cleanupFindings = summary.cleanupRequired.map(
    (cleanup): HealthFinding => ({
      evidence: {
        brandId: cleanup.brandId,
        cleanupRequired: true,
        field: cleanup.field,
      },
      fingerprint: `link:cleanup-required:${cleanup.brandId}:${cleanup.field}`,
      humanReason: "Link, image, and brand-field cleanup are human-owned",
      mergePolicy: "human",
      severity: "medium",
      source: "link",
      title: "Link cleanup requires review",
    }),
  );
  const evaluatedFindings = evaluated.findings.map(
    (finding): HealthFinding => ({
      ...finding,
      fingerprint: `link:${finding.fingerprint.slice("directory:".length)}`,
      source: "link",
    }),
  );
  const findings = [
    ...cleanupFindings,
    ...evaluatedFindings.filter(
      (finding) =>
        !cleanupFindings.some(
          (cleanup) => cleanup.fingerprint === finding.fingerprint,
        ),
    ),
  ];
  return {
    collectedAt,
    evidence: { mode, source: "link_health_endpoint" },
    failures: [],
    findings,
    routine: "link-checker",
    skippedActions: [],
    snapshot: {
      endpoint: objectValue(summary),
      telemetry: objectValue(evaluated.snapshot),
    },
    status: "success",
    version: 1,
  };
}

export function makeDirectoryArtifact(
  input: DirectoryHealthInput,
  collectedAt: string,
): HealthCollectorArtifact {
  const evaluated = evaluateDirectoryHealth(input);
  return {
    collectedAt,
    evidence: { source: "directory_evidence" },
    failures: [],
    findings: evaluated.findings,
    routine: "directory-health",
    skippedActions: [],
    snapshot: objectValue(evaluated.snapshot),
    status: "success",
    version: 1,
  };
}

export async function collectLinkArtifact(
  input: LinkCollectInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<HealthCollectorArtifact> {
  const files = filesFor(dependencies);
  const runAt = input.runAt ?? new Date().toISOString();
  let artifact: HealthCollectorArtifact;
  try {
    const response = input.inputPath
      ? await readBoundedJson(input.inputPath, files)
      : await executeLinkHealthRequest(
          buildLinkHealthRequest({
            dryRun: input.mode === "preflight",
            endpoint: optionalEnvironment(
              environmentFor(dependencies),
              "FORMORIA_LINK_HEALTH_URL",
            ),
            mode: input.mode,
            originSecret: optionalEnvironment(
              environmentFor(dependencies),
              "FORMORIA_LINK_HEALTH_ORIGIN_SECRET",
            ),
            railwayUrl: optionalEnvironment(
              environmentFor(dependencies),
              "FORMORIA_RAILWAY_URL",
            ),
            runIdentity: optionalEnvironment(
              environmentFor(dependencies),
              "HEALTH_RUN_IDENTITY",
            ),
            workflowAttempt: input.workflowAttempt,
            workflowRunId: input.workflowRunId,
          }),
          {
            fetchImplementation: fetchFor(dependencies),
            originSecret: optionalEnvironment(
              environmentFor(dependencies),
              "FORMORIA_LINK_HEALTH_ORIGIN_SECRET",
            ),
          },
        );
    if (!isRecord(response)) throw new Error("link_summary_invalid");
    artifact = makeLinkArtifact(
      response as unknown as LinkHealthSummaryInput,
      runAt,
      input.mode,
    );
  } catch {
    artifact = failedCollectorArtifact(
      "link-checker",
      runAt,
      "link_collection_failed",
    );
  }
  await writeRedactedJson(input.outputPath, artifact, files);
  return artifact;
}

function normalizeSentryCollectionArtifact(
  value: unknown,
): SanitizedSentryArtifact {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("sentry_collection_artifact_invalid");
  }
  const rawIssues = value.issues;
  if (!Array.isArray(rawIssues) || rawIssues.length > MAX_RUNTIME_ISSUES) {
    throw new Error("sentry_collection_issues_invalid");
  }
  const issues = rawIssues.map((issue) => sanitizeSentryIssue(issue));
  const incidentMode = value.incidentMode === true;
  const hasMore = value.hasMore === true;
  const requestCount =
    typeof value.requestCount === "number" ? value.requestCount : 0;
  return {
    candidateIssueCount: issues.length,
    classificationsRequired: issues.length,
    hasMore,
    incidentMode,
    issues,
    requestCount,
    status: value.status === "failed" ? "failed" : "success",
    version: 1,
  };
}

export function finalizeSentryArtifact(
  collection: SentryCollectionInput,
  classifications: readonly unknown[],
  collectedAt: string,
): HealthCollectorArtifact {
  if (collection.issues.length !== classifications.length) {
    throw new Error("sentry_classification_count_invalid");
  }
  const findings = collection.issues.map((rawIssue, index) => {
    const issue = sanitizeSentryIssue(rawIssue);
    const candidate = classifications[index];
    if (candidate === undefined)
      throw new Error("sentry_classification_missing");
    const classification = SentryClassificationSchema.parse(candidate);
    return buildSentryHealthFinding(issue, classification, {
      incidentMode: collection.incidentMode,
    });
  });
  return {
    collectedAt,
    evidence: { source: "sanitized_sentry_and_classifier" },
    failures: [],
    findings,
    routine: "sentry-triage",
    skippedActions: [],
    snapshot: objectValue({
      candidateIssueCount: collection.candidateIssueCount,
      classifiedIssueCount: findings.length,
      hasMore: collection.hasMore,
      incidentMode: collection.incidentMode,
      requestCount: collection.requestCount,
    }),
    status: "success",
    version: 1,
  };
}

export function validateSanitizedSentryArtifact(
  value: unknown,
): SanitizedSentryArtifact {
  return normalizeSentryCollectionArtifact(value);
}

export async function collectSanitizedSentryArtifact(
  input: SentryCollectInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<SanitizedSentryArtifact> {
  const files = filesFor(dependencies);
  let artifact: SanitizedSentryArtifact;
  try {
    const environment = environmentFor(dependencies);
    const result = await collectSentryIssues({
      audit: auditFor(dependencies),
      baseUrl: optionalEnvironment(environment, "SENTRY_BASE_URL"),
      fetchImpl: fetchFor(dependencies),
      maxPages: 3,
      maxRequests: 3,
      organization: optionalEnvironment(environment, "SENTRY_ORGANIZATION"),
      project: optionalEnvironment(environment, "SENTRY_PROJECT"),
      readToken: optionalEnvironment(environment, "SENTRY_READ_TOKEN"),
    });
    artifact = {
      candidateIssueCount: result.candidateIssueCount,
      classificationsRequired: result.issues.length,
      hasMore: result.hasMore,
      incidentMode: result.incidentMode,
      issues: result.issues.map(sanitizeSentryIssue),
      requestCount: result.requestCount,
      status: "success",
      version: 1,
    };
  } catch {
    artifact = {
      candidateIssueCount: 0,
      classificationsRequired: 0,
      hasMore: false,
      incidentMode: false,
      issues: [],
      requestCount: 0,
      status: "failed",
      version: 1,
    };
  }
  await writeRedactedJson(input.outputPath, artifact, files);
  return artifact;
}

export async function collectDirectoryEvidence(
  input: DirectoryEvidenceCollectInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<DirectoryHealthInput> {
  const files = filesFor(dependencies);
  let evidence: unknown;
  if (input.inputPath) {
    try {
      evidence = await readBoundedJson(input.inputPath, files);
    } catch {
      evidence = undefined;
    }
  }
  if (!isDirectoryHealthInput(evidence)) {
    const endpoint = optionalEnvironment(
      environmentFor(dependencies),
      "DIRECTORY_EVIDENCE_URL",
    );
    if (endpoint) {
      const startedAt = performance.now();
      try {
        const response = await fetchFor(dependencies)(endpoint, {
          headers: {
            Accept: "application/json",
            ...(optionalEnvironment(
              environmentFor(dependencies),
              "HEALTH_AGENT_READER_TOKEN",
            )
              ? {
                  Authorization: `Bearer ${optionalEnvironment(
                    environmentFor(dependencies),
                    "HEALTH_AGENT_READER_TOKEN",
                  )}`,
                }
              : {}),
          },
          method: "GET",
          signal: signal(15_000),
        });
        const body = await jsonResponse(response);
        const schemaValid = response.ok && isDirectoryHealthInput(body);
        auditFor(dependencies)({
          adapter: "directory-evidence",
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          operation: "read_evidence",
          request: { resource: "directory_evidence" },
          response: { httpStatus: response.status, body: objectValue(body) },
          schemaValid,
          status: schemaValid ? "success" : "failure",
        });
        if (schemaValid) evidence = body;
      } catch {
        auditFor(dependencies)({
          adapter: "directory-evidence",
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          operation: "read_evidence",
          request: { resource: "directory_evidence" },
          response: { error: "request_failed" },
          schemaValid: false,
          status: "failure",
        });
      }
    }
  }
  if (!isDirectoryHealthInput(evidence)) {
    const link = input.linkArtifactPath
      ? await loadCollectorArtifact(
          "link-checker",
          input.linkArtifactPath,
          undefined,
          files,
        )
      : failedCollectorArtifact("link-checker");
    evidence = await defaultDirectoryCollector(dependencies, link);
  }
  if (!isDirectoryHealthInput(evidence)) {
    throw new Error("directory_evidence_unavailable");
  }
  const normalizedEvidence = evidence;
  const normalized = evaluateDirectoryHealth(normalizedEvidence);
  const output = { ...normalizedEvidence, evaluated: normalized.snapshot };
  await writeRedactedJson(input.outputPath, output, files);
  return normalizedEvidence;
}

function classificationValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.classifications)) {
    return value.classifications;
  }
  if (isRecord(value) && value.result !== undefined) {
    return classificationValues(value.result);
  }
  return [value];
}

function normalizeClassificationArtifact(
  value: unknown,
): SentryClassificationArtifact {
  const raw = classificationValues(value);
  if (raw.length > MAX_RUNTIME_ISSUES) {
    throw new Error("sentry_classification_count_invalid");
  }
  return {
    classifications: raw.map((candidate) =>
      SentryClassificationSchema.parse(candidate),
    ),
    status: "success",
    version: 1,
  };
}

export function validateSentryClassificationArtifact(
  value: unknown,
): SentryClassificationArtifact {
  if (isRecord(value) && value.version === 1 && value.classifications) {
    return normalizeClassificationArtifact(value.classifications);
  }
  return normalizeClassificationArtifact(value);
}

export async function prepareSentryClassificationArtifact(
  input: SentryClassifyInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<SentryClassificationArtifact> {
  const value = await readBoundedJson(input.inputPath, filesFor(dependencies));
  const artifact = normalizeClassificationArtifact(value);
  await writeRedactedJson(input.outputPath, artifact, filesFor(dependencies));
  return artifact;
}

export async function combineSentryClassificationArtifact(
  input: SentryCombineInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<HealthCollectorArtifact> {
  const files = filesFor(dependencies);
  const runAt = input.runAt ?? new Date().toISOString();
  let artifact: HealthCollectorArtifact;
  try {
    const issues = normalizeSentryCollectionArtifact(
      await readBoundedJson(input.issuesPath, files),
    );
    const classifications = normalizeClassificationArtifact(
      await readBoundedJson(input.classificationsPath, files),
    );
    if (
      issues.status !== "success" ||
      classifications.status !== "success" ||
      issues.issues.length !== classifications.classifications.length
    ) {
      throw new Error("sentry_classification_input_incomplete");
    }
    artifact = finalizeSentryArtifact(
      issues,
      classifications.classifications,
      runAt,
    );
  } catch {
    artifact = failedCollectorArtifact(
      "sentry-triage",
      runAt,
      "sentry_classification_failed",
    );
  }
  await writeRedactedJson(input.outputPath, artifact, files);
  return artifact;
}

export async function evaluateDirectoryArtifact(
  input: DirectoryEvaluateInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<HealthCollectorArtifact> {
  const files = filesFor(dependencies);
  let evidence: unknown;
  try {
    evidence = await readBoundedJson(input.evidencePath, files);
  } catch {
    evidence = undefined;
  }

  let artifact = await collectDirectoryArtifact(
    {
      linkArtifactPath: input.linkArtifactPath,
      mode: input.mode,
      outputPath: input.outputPath,
      runAt: input.runAt,
      ...(isDirectoryHealthInput(evidence) ? { input: evidence } : {}),
    },
    dependencies,
  );
  if (input.mode !== "preflight" && isDirectoryHealthInput(evidence)) {
    try {
      await supabaseRequest(
        dependencies,
        "record_health_snapshot",
        "/rest/v1/rpc/record_health_snapshot",
        "HEALTH_AGENT_WRITER_TOKEN",
        {
          body: JSON.stringify({
            p_metrics: {
              approvedBrands: {
                addedToday: evidence.approvedBrands.addedToday,
                totalApproved: evidence.approvedBrands.totalApproved,
              },
              database: evidence.database,
            },
            p_snapshot_date: taipeiDate(input.runAt),
          }),
          method: "POST",
        },
        (value) =>
          isRecord(value) || (Array.isArray(value) && value.length === 1),
      );
    } catch {
      artifact = {
        ...artifact,
        failures: [...artifact.failures, "directory_snapshot_record_failed"],
        status: "failed",
      };
      await writeRedactedJson(input.outputPath, artifact, files);
    }
  }
  return artifact;
}

export async function runAggregateAndDeliver(
  input: AggregateWorkflowInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<AggregateResult> {
  const result = await aggregateAndDeliver(
    {
      artifactPaths: {
        "directory-health": input.directoryArtifactPath,
        "link-checker": input.linkArtifactPath,
        "sentry-triage": input.sentryArtifactPath,
      },
      exhaustedAutomationFingerprints: input.exhaustedAutomationFingerprints,
      mode: input.mode,
      prOutcomes: input.prOutcomes,
      runAt: input.runAt,
      workflowAttempt: input.workflowAttempt,
      workflowRunId: input.workflowRunId,
    },
    dependencies,
  );
  await writeRedactedJson(input.outputPath, result, filesFor(dependencies));
  if (input.auditPath) {
    await writeAuditArtifact(
      input.auditPath,
      dependencies.auditRecords ?? [],
      filesFor(dependencies),
    );
  }
  return result;
}

function findingsFromArtifact(value: unknown): readonly HealthFinding[] {
  if (isRecord(value) && value.routine && value.findings) {
    return validateCollectorArtifact(value).findings;
  }
  if (isRecord(value) && isRecord(value.artifacts)) {
    const findings: HealthFinding[] = [];
    for (const artifact of Object.values(value.artifacts)) {
      if (!isRecord(artifact) || !Array.isArray(artifact.findings)) continue;
      findings.push(...validateCollectorArtifact(artifact).findings);
    }
    if (findings.length > MAX_RUNTIME_FINDINGS) {
      throw new Error("repair_findings_too_large");
    }
    return findings;
  }
  if (isRecord(value) && isRecord(value.snapshot) && value.snapshot.findings) {
    return repairFindingsFromValue(value.snapshot);
  }
  if (isRecord(value) && isRecord(value.partition)) {
    return repairFindingsFromValue(value.partition);
  }
  if (isRecord(value) && Array.isArray(value.findings)) {
    if (value.findings.length > MAX_RUNTIME_FINDINGS) {
      throw new Error("repair_findings_too_large");
    }
    return value.findings as HealthFinding[];
  }
  throw new Error("repair_findings_missing");
}

export async function enqueueAndClaimWorkflowBatch(
  input: QueueWorkflowInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<QueueBatchResult> {
  const value = await readBoundedJson(
    input.findingsArtifactPath,
    filesFor(dependencies),
  );
  const result = await enqueueAndClaimBatch(
    {
      canaryFingerprints: input.canaryFingerprints,
      findings: findingsFromArtifact(value),
      leaseOwner: input.leaseOwner,
      mode: input.mode,
    },
    dependencies.queue ?? supabaseQueueDependencies(dependencies),
    environmentFor(dependencies),
  );
  await writeRedactedJson(input.outputPath, result, filesFor(dependencies));
  return result;
}

function repairFindingFromValue(value: unknown): RepairFinding {
  if (!isRecord(value)) throw new Error("repair_finding_invalid");
  const fingerprint =
    typeof value.fingerprint === "string" ? value.fingerprint : "";
  const source = value.source;
  const mergePolicy = value.mergePolicy ?? value.merge_policy;
  const title = typeof value.title === "string" ? value.title : "";
  if (
    !fingerprint.trim() ||
    (source !== "link" && source !== "directory" && source !== "sentry") ||
    (mergePolicy !== "automatic" && mergePolicy !== "human") ||
    !title.trim()
  ) {
    throw new Error("repair_finding_invalid");
  }
  const severity =
    value.severity === "low" ||
    value.severity === "medium" ||
    value.severity === "high" ||
    value.severity === "critical"
      ? value.severity
      : "medium";
  const changedFiles = Array.isArray(value.changedFiles)
    ? value.changedFiles.filter(
        (path): path is string =>
          typeof path === "string" && path.trim().length > 0,
      )
    : undefined;
  const sensitivePaths = Array.isArray(value.sensitivePaths)
    ? value.sensitivePaths.filter(
        (path): path is string =>
          typeof path === "string" && path.trim().length > 0,
      )
    : undefined;
  return {
    evidence: objectValue(value.evidence),
    fingerprint,
    mergePolicy,
    severity,
    source,
    title,
    ...(typeof value.claimedFindingId === "string"
      ? { claimedFindingId: value.claimedFindingId }
      : {}),
    ...(typeof value.humanReason === "string"
      ? { humanReason: value.humanReason }
      : {}),
    ...(typeof value.evidenceArtifactRef === "string"
      ? { evidenceArtifactRef: value.evidenceArtifactRef }
      : {}),
    ...(changedFiles ? { changedFiles } : {}),
    ...(typeof value.rootCauseKey === "string"
      ? { rootCauseKey: value.rootCauseKey }
      : {}),
    ...(typeof value.confidence === "number"
      ? { confidence: value.confidence }
      : {}),
    ...(value.reproducible === true || value.reproducible === false
      ? { reproducible: value.reproducible }
      : {}),
    ...(value.behaviorChangeRisk === "low" ||
    value.behaviorChangeRisk === "medium" ||
    value.behaviorChangeRisk === "high" ||
    value.behaviorChangeRisk === "unknown"
      ? { behaviorChangeRisk: value.behaviorChangeRisk }
      : {}),
    ...(sensitivePaths ? { sensitivePaths } : {}),
    ...(value.defectKind === "application" ||
    value.defectKind === "dependency" ||
    value.defectKind === "unknown"
      ? { defectKind: value.defectKind }
      : {}),
    ...(value.dependencyImpact === "patch" ||
    value.dependencyImpact === "minor" ||
    value.dependencyImpact === "major" ||
    value.dependencyImpact === "unknown"
      ? { dependencyImpact: value.dependencyImpact }
      : {}),
    ...(value.fixability === "low" ||
    value.fixability === "medium" ||
    value.fixability === "high" ||
    value.fixability === "unknown"
      ? { fixability: value.fixability }
      : {}),
  };
}

function repairFindingsFromValue(value: unknown): readonly RepairFinding[] {
  if (!isRecord(value) || !Array.isArray(value.findings)) {
    throw new Error("repair_findings_missing");
  }
  if (value.findings.length > MAX_RUNTIME_FINDINGS) {
    throw new Error("repair_findings_too_large");
  }
  return value.findings.map(repairFindingFromValue);
}

async function readRepairSnapshot(
  path: string,
  dependencies: WorkflowRuntimeDependencies,
): Promise<RepairSnapshot> {
  const value = await readBoundedJson(path, filesFor(dependencies));
  if (isRecord(value) && value.snapshot && isRecord(value.snapshot)) {
    return readRepairSnapshotValue(value.snapshot);
  }
  return readRepairSnapshotValue(value);
}

function readRepairSnapshotValue(value: unknown): RepairSnapshot {
  if (isRecord(value) && Array.isArray(value.findings)) {
    return snapshotClaimedFindings(repairFindingsFromValue(value));
  }
  throw new Error("repair_snapshot_invalid");
}

export async function prepareRepairSnapshot(
  input: RepairSnapshotInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<RepairSnapshot> {
  const value = await readBoundedJson(input.inputPath, filesFor(dependencies));
  const selected =
    input.batchKind && isRecord(value) && value[input.batchKind] !== undefined
      ? value[input.batchKind]
      : value;
  const findings = findingsFromArtifact(selected).map(repairFindingFromValue);
  const snapshot = snapshotClaimedFindings(findings);
  await writeRedactedJson(input.outputPath, snapshot, filesFor(dependencies));
  return snapshot;
}

function repairBatchMetadata(batch: RepairPartition["automatic"]): JsonObject {
  return {
    batch_kind: batch.batchKind,
    branch_name: batch.branchName,
    finding_count: batch.findings.length,
    claimed_finding_ids: batch.findings
      .map((finding) => finding.claimedFindingId)
      .filter((value): value is string => Boolean(value)),
    finding_policies: batch.findingPolicies as unknown as JsonValue,
    merge_policy: batch.mergePolicy,
    snapshot_id: batch.snapshotId,
    traceability: redactForAudit(
      batch.clusters.flatMap((cluster) => cluster.traceability),
    ),
  };
}

export async function prepareRepairMetadata(
  input: RepairMetadataInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<JsonObject> {
  const snapshot = await readRepairSnapshot(input.snapshotPath, dependencies);
  const partition = partitionRepairBatch(snapshot);
  const metadata: JsonObject = {
    automatic: repairBatchMetadata(partition.automatic),
    human: repairBatchMetadata(partition.human),
    snapshot_id: snapshot.snapshotId,
    version: 1,
  };
  await writeRedactedJson(input.outputPath, metadata, filesFor(dependencies));
  return metadata;
}

export async function prepareRepairAudit(
  input: RepairAuditInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<JsonObject> {
  const snapshot = await readRepairSnapshot(input.snapshotPath, dependencies);
  const partition = partitionRepairBatch(snapshot);
  const metadata = input.metadataPath
    ? await readBoundedJson(input.metadataPath, filesFor(dependencies))
    : undefined;
  const result = input.resultPath
    ? await readBoundedJson(input.resultPath, filesFor(dependencies))
    : undefined;
  const audit: JsonObject = {
    batches: {
      automatic: {
        branch_name: buildRepairBranchName(partition.automatic),
        finding_count: partition.automatic.findings.length,
      },
      human: {
        branch_name: buildRepairBranchName(partition.human),
        finding_count: partition.human.findings.length,
      },
    },
    findings: redactForAudit(
      snapshot.findings.map((finding) => ({
        changed_files: finding.changedFiles ?? [],
        evidence_artifact_ref: redactEvidenceArtifactReference(
          finding.evidenceArtifactRef ?? null,
        ),
        fingerprint: finding.fingerprint,
        merge_policy: finding.mergePolicy,
        root_cause_key: finding.rootCauseKey ?? finding.fingerprint,
        source: finding.source,
      })),
    ),
    metadata: metadata ? objectValue(metadata) : {},
    result:
      result && isRecord(result)
        ? {
            auto_merge_enabled: result.autoMergeEnabled === true,
            auto_merge_eligible: result.autoMergeEligible === true,
            fixed: result.fixed === true,
            merged: result.merged === true,
            status:
              typeof result.status === "string" ? result.status : "unknown",
          }
        : {},
    snapshot_id: snapshot.snapshotId,
    version: 1,
  };
  await writeRedactedJson(input.outputPath, audit, filesFor(dependencies));
  return audit;
}

function claimedFindingIds(
  value: unknown,
  policy: "automatic" | "human",
): string[] {
  if (!isRecord(value)) throw new Error("repair_metadata_invalid");
  const batch = isRecord(value[policy]) ? value[policy] : value;
  const ids = isRecord(batch) ? batch.claimed_finding_ids : undefined;
  if (!Array.isArray(ids)) throw new Error("repair_claimed_ids_missing");
  return ids.filter(
    (id): id is string =>
      typeof id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      ),
  );
}

async function transitionRepairResult(
  id: string,
  input: RepairResultInput,
  dependencies: WorkflowRuntimeDependencies,
): Promise<void> {
  const transition = async (expected: string, next: string) =>
    supabaseRequest(
      dependencies,
      `transition_health_fix_${next}`,
      "/rest/v1/rpc/transition_health_fix",
      "HEALTH_AGENT_WRITER_TOKEN",
      {
        body: JSON.stringify({
          p_confirmation_data: null,
          p_deployed_at: null,
          p_expected_status: expected,
          p_id: id,
          p_last_error: null,
          p_lease_owner: input.leaseOwner,
          p_merge_sha: null,
          p_new_status: next,
          p_next_attempt_at: null,
          p_pr_number: input.prNumber,
          p_pr_url: input.prUrl,
        }),
        method: "POST",
      },
      (value) =>
        isRecord(value) || (Array.isArray(value) && value.length === 1),
    );
  await transition("claimed", "pr_opened");
  if (input.mergePolicy === "human") {
    await transition("pr_opened", "awaiting_human");
  }
}

export async function deliverRepairResult(
  input: RepairResultInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<JsonObject> {
  const metadata = await readBoundedJson(
    input.metadataPath,
    filesFor(dependencies),
  );
  const ids = claimedFindingIds(metadata, input.mergePolicy);
  if (ids.length === 0) throw new Error("repair_claimed_ids_empty");
  await Promise.all(
    ids.map((id) => transitionRepairResult(id, input, dependencies)),
  );
  const envelope = buildPrResultEnvelope({
    mergePolicy: input.mergePolicy,
    mode: "live",
    prNumber: input.prNumber,
    result: {
      autoMergeEnabled: input.autoMergeEnabled,
      fixed: false,
      merged: false,
      mergePolicy: input.mergePolicy,
      prNumber: input.prNumber,
      status: input.mergePolicy === "human" ? "awaiting_human" : "pr_opened",
    },
    runAt: input.runAt,
    status: "opened",
    workflowAttempt: input.workflowAttempt,
    workflowRunId: input.workflowRunId,
  });
  const delivery = dependencies.delivery;
  if (!delivery) throw new Error("repair_result_delivery_unavailable");
  const report: SlackDigestInput = {
    actionableFindings: [],
    failures: [],
    linearOutcomes: [],
    prOutcomes: [
      {
        auto_merge_enabled: input.autoMergeEnabled,
        merge_policy: input.mergePolicy,
        merged: false,
        pr_number: input.prNumber,
        pr_url: input.prUrl,
        status: envelope.data.status,
      },
    ],
    skippedActions: [],
  };
  const [agentHub, slack] = await Promise.allSettled([
    delivery.agentHub(envelope),
    delivery.slack(report),
  ]);
  const result: JsonObject = {
    agent_hub: agentHub.status,
    auto_merge_enabled: input.autoMergeEnabled,
    claimed_finding_ids: ids,
    merge_policy: input.mergePolicy,
    merged: false,
    pr_number: input.prNumber,
    pr_url: input.prUrl,
    slack: slack.status,
    status: envelope.data.status,
  };
  await writeRedactedJson(input.outputPath, result, filesFor(dependencies));
  if (agentHub.status === "rejected" || slack.status === "rejected") {
    throw new Error("repair_result_delivery_failed");
  }
  return result;
}

function canonicalCommand(
  command: WorkflowRuntimeCommand,
): WorkflowRuntimeCommand {
  switch (command) {
    case "link-collect":
      return "collect-link";
    case "directory-evidence":
      return "collect-directory-evidence";
    case "sentry-classify-combine":
      return "combine-sentry";
    case "directory-collect":
      return "evaluate-directory";
    case "enqueue-claim-batch":
      return "enqueue-and-claim";
    case "prepare-repair-snapshot":
      return "repair-snapshot";
    case "prepare-repair-metadata":
      return "repair-metadata";
    case "prepare-repair-audit":
      return "repair-audit";
    default:
      return command;
  }
}

export async function runWorkflowCommand(
  command: WorkflowRuntimeCommand,
  input: Record<string, unknown>,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<unknown> {
  switch (canonicalCommand(command)) {
    case "collect-link":
      return collectLinkArtifact(
        {
          inputPath:
            typeof input.inputPath === "string" ? input.inputPath : undefined,
          mode: safeMode(input.mode),
          outputPath: safeString(input.outputPath, "outputPath"),
          runAt: typeof input.runAt === "string" ? input.runAt : undefined,
          workflowAttempt: safeAttempt(input.workflowAttempt),
          workflowRunId: safeString(input.workflowRunId, "workflowRunId"),
        },
        dependencies,
      );
    case "collect-directory-evidence":
      return collectDirectoryEvidence(
        {
          inputPath:
            typeof input.inputPath === "string" ? input.inputPath : undefined,
          linkArtifactPath:
            typeof input.linkArtifactPath === "string"
              ? input.linkArtifactPath
              : undefined,
          outputPath: safeString(input.outputPath, "outputPath"),
        },
        dependencies,
      );
    case "collect-sentry":
      return collectSanitizedSentryArtifact(
        {
          mode: safeMode(input.mode),
          outputPath: safeString(input.outputPath, "outputPath"),
        },
        dependencies,
      );
    case "classify-sentry":
      return prepareSentryClassificationArtifact(
        {
          inputPath: safeString(input.inputPath, "inputPath"),
          outputPath: safeString(input.outputPath, "outputPath"),
        },
        dependencies,
      );
    case "combine-sentry":
      return combineSentryClassificationArtifact(
        {
          classificationsPath: safeString(
            input.classificationsPath,
            "classificationsPath",
          ),
          issuesPath: safeString(input.issuesPath, "issuesPath"),
          mode: safeMode(input.mode),
          outputPath: safeString(input.outputPath, "outputPath"),
          runAt: typeof input.runAt === "string" ? input.runAt : undefined,
        },
        dependencies,
      );
    case "evaluate-directory":
      return evaluateDirectoryArtifact(
        {
          evidencePath: safeString(input.evidencePath, "evidencePath"),
          linkArtifactPath: safeString(
            input.linkArtifactPath,
            "linkArtifactPath",
          ),
          mode: safeMode(input.mode),
          outputPath: safeString(input.outputPath, "outputPath"),
          runAt: safeString(input.runAt, "runAt"),
        },
        dependencies,
      );
    case "aggregate-and-deliver":
      return runAggregateAndDeliver(
        {
          auditPath:
            typeof input.auditPath === "string" ? input.auditPath : undefined,
          directoryArtifactPath: safeString(
            input.directoryArtifactPath,
            "directoryArtifactPath",
          ),
          exhaustedAutomationFingerprints: Array.isArray(
            input.exhaustedAutomationFingerprints,
          )
            ? input.exhaustedAutomationFingerprints.filter(
                (value): value is string => typeof value === "string",
              )
            : undefined,
          linkArtifactPath: safeString(
            input.linkArtifactPath,
            "linkArtifactPath",
          ),
          mode: safeMode(input.mode),
          outputPath: safeString(input.outputPath, "outputPath"),
          prOutcomes: Array.isArray(input.prOutcomes)
            ? (input.prOutcomes as JsonValue[])
            : undefined,
          runAt: safeString(input.runAt, "runAt"),
          sentryArtifactPath: safeString(
            input.sentryArtifactPath,
            "sentryArtifactPath",
          ),
          workflowAttempt: safeAttempt(input.workflowAttempt),
          workflowRunId: safeString(input.workflowRunId, "workflowRunId"),
        },
        dependencies,
      );
    case "enqueue-and-claim":
      return enqueueAndClaimWorkflowBatch(
        {
          canaryFingerprints: Array.isArray(input.canaryFingerprints)
            ? input.canaryFingerprints.filter(
                (value): value is string => typeof value === "string",
              )
            : undefined,
          findingsArtifactPath: safeString(
            input.findingsArtifactPath,
            "findingsArtifactPath",
          ),
          leaseOwner: safeString(input.leaseOwner, "leaseOwner"),
          mode: safeMode(input.mode),
          outputPath: safeString(input.outputPath, "outputPath"),
        },
        dependencies,
      );
    case "repair-snapshot":
      return prepareRepairSnapshot(
        {
          batchKind:
            input.batchKind === "automatic" || input.batchKind === "human"
              ? input.batchKind
              : undefined,
          inputPath: safeString(input.inputPath, "inputPath"),
          outputPath: safeString(input.outputPath, "outputPath"),
        },
        dependencies,
      );
    case "repair-metadata":
      return prepareRepairMetadata(
        {
          outputPath: safeString(input.outputPath, "outputPath"),
          snapshotPath: safeString(input.snapshotPath, "snapshotPath"),
        },
        dependencies,
      );
    case "repair-audit":
      return prepareRepairAudit(
        {
          metadataPath:
            typeof input.metadataPath === "string"
              ? input.metadataPath
              : undefined,
          outputPath: safeString(input.outputPath, "outputPath"),
          resultPath:
            typeof input.resultPath === "string" ? input.resultPath : undefined,
          snapshotPath: safeString(input.snapshotPath, "snapshotPath"),
        },
        dependencies,
      );
    case "repair-result":
      return deliverRepairResult(
        {
          autoMergeEnabled: input.autoMergeEnabled === true,
          leaseOwner: safeString(input.leaseOwner, "leaseOwner"),
          mergePolicy:
            input.mergePolicy === "automatic" || input.mergePolicy === "human"
              ? input.mergePolicy
              : (() => {
                  throw new Error("invalid_merge_policy");
                })(),
          metadataPath: safeString(input.metadataPath, "metadataPath"),
          outputPath: safeString(input.outputPath, "outputPath"),
          prNumber: safeAttempt(input.prNumber),
          prUrl: safeString(input.prUrl, "prUrl"),
          runAt: safeString(input.runAt, "runAt"),
          workflowAttempt: safeAttempt(input.workflowAttempt),
          workflowRunId: safeString(input.workflowRunId, "workflowRunId"),
        },
        dependencies,
      );
  }
}

function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function requiredArgument(argv: readonly string[], name: string): string {
  return safeString(argument(argv, name), name);
}

function optionalArgument(
  argv: readonly string[],
  name: string,
): string | undefined {
  const value = argument(argv, name);
  return value ? safeString(value, name) : undefined;
}

export async function main(
  argv = process.argv.slice(2),
  dependencies?: WorkflowRuntimeDependencies,
): Promise<void> {
  const commandValue = argv.at(0);
  if (!commandValue) throw new Error("runtime_command_required");
  const runtime = dependencies ?? createWorkflowRuntimeDependencies();
  const mode = optionalArgument(argv, "--mode");
  const attempt = optionalArgument(argv, "--attempt");
  const input: Record<string, unknown> = {
    auditPath: optionalArgument(argv, "--audit"),
    batchKind: optionalArgument(argv, "--batch"),
    canaryFingerprints: optionalArgument(argv, "--canary-fingerprints")
      ?.split(",")
      .filter(Boolean),
    classificationsPath: optionalArgument(argv, "--classifications"),
    directoryArtifactPath: optionalArgument(argv, "--directory-artifact"),
    evidencePath: optionalArgument(argv, "--evidence"),
    findingsArtifactPath: optionalArgument(argv, "--findings-artifact"),
    inputPath: optionalArgument(argv, "--input"),
    issuesPath: optionalArgument(argv, "--issues"),
    leaseOwner: optionalArgument(argv, "--lease-owner"),
    linkArtifactPath: optionalArgument(argv, "--link-artifact"),
    metadataPath: optionalArgument(argv, "--metadata"),
    mergePolicy: optionalArgument(argv, "--merge-policy"),
    mode,
    outputPath: requiredArgument(argv, "--output"),
    prNumber: optionalArgument(argv, "--pr-number"),
    prUrl: optionalArgument(argv, "--pr-url"),
    resultPath: optionalArgument(argv, "--result"),
    runAt: optionalArgument(argv, "--run-at"),
    sentryArtifactPath: optionalArgument(argv, "--sentry-artifact"),
    snapshotPath: optionalArgument(argv, "--snapshot"),
    workflowAttempt: attempt ? Number(attempt) : undefined,
    workflowRunId: optionalArgument(argv, "--run-id"),
    autoMergeEnabled: optionalArgument(argv, "--auto-merge-enabled") === "true",
  };
  await runWorkflowCommand(
    commandValue as WorkflowRuntimeCommand,
    input,
    runtime,
  );
  const auditPath =
    typeof input.auditPath === "string" ? input.auditPath : undefined;
  if (auditPath && commandValue !== "aggregate-and-deliver") {
    await writeAuditArtifact(
      auditPath,
      runtime.auditRecords ?? [],
      filesFor(runtime),
    );
  }
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  main().catch(() => {
    console.error("Health agent workflow runtime failed");
    process.exitCode = 1;
  });
}
