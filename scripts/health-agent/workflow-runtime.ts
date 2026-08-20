import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  ONLINE_STORES,
  ONLINE_STORE_COLUMNS,
  type OnlineStoreCamelField,
} from "@/lib/brands/online-stores";
import { createAgentHubDelivery } from "../agent-hub/delivery.mjs";
import {
  createAgentHubAdapter,
  createGitHubAdapter,
  createLinearAdapter,
  resolveSentryIssues,
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
import { evaluateBrandReview, type RecentBrandEdit } from "./brand-review";
import {
  buildSentryHealthFinding,
  collectSentryIssues,
  sanitizeSentryCandidate,
  SentryClassificationSchema,
  type SanitizedSentryCandidate,
  type SentryClassification,
} from "./sentry";
import {
  buildRepairBranchName,
  managerRepairSnapshot,
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
  enqueueAndClaimPolicyBatches,
  executeLinkHealthRequest,
  failedCollectorArtifact,
  internalErrorCode,
  loadCollectorArtifact,
  readBoundedJson,
  redactForAudit,
  safeEndpoint,
  safeErrorCode,
  taipeiDate,
  validateCollectorArtifact,
  writeRedactedJson,
  type AggregateResult,
  type ArtifactFileSystem,
  type DirectoryCollectionProvider,
  type HealthAgentDependencies,
  type HealthAgentEnvelope,
  type HealthCollectorArtifact,
  type HealthRoutine,
  type LinearSyncInput,
  type LinearSyncResult,
  type JsonFileStore,
  type QueueBatchResult,
  type SlackDigestInput,
} from "./orchestrator";
import {
  requiresHumanPolicy,
  type AuditLogger,
  type AuditRecord,
  type HealthDeliveryWarning,
  type HealthFinding,
  type HealthFindingLifecycle,
  type HealthInfrastructureFailure,
  type HealthSource,
  type HealthSummary,
  type JsonValue,
} from "./contracts";
import {
  CRON_HEALTH_LOOKBACK_HOURS,
  evaluateCronHealth,
  type CronHttpLogRow,
} from "./cron-health";
import {
  isTrailSupplyReport,
  parseTrailSupplyReport,
  trailSupplyArtifact,
  UNOBSERVED_TRAIL_SUPPLY,
  type TrailSupplyArtifact,
} from "./trail-supply";

const MAX_RUNTIME_FINDINGS = 10_000;
const FINGERPRINT_STATE_BATCH_SIZE = 40;
// Mirrors health_fix_queue_active_fingerprint_idx: every status except the two
// terminal ones ('fixed', 'skipped').
const ACTIVE_QUEUE_STATUSES = [
  "pending",
  "claimed",
  "pr_opened",
  "awaiting_human",
  "merged",
  "deployed",
  "failed",
  "needs_human",
] as const;
const MAX_RUNTIME_ISSUES = 20;
const execFileAsync = promisify(execFile);

function fingerprintBatches(
  fingerprints: readonly string[],
): readonly string[][] {
  return Array.from(
    {
      length: Math.ceil(fingerprints.length / FINGERPRINT_STATE_BATCH_SIZE),
    },
    (_, index) =>
      fingerprints.slice(
        index * FINGERPRINT_STATE_BATCH_SIZE,
        (index + 1) * FINGERPRINT_STATE_BATCH_SIZE,
      ),
  );
}

function safeRuntimeFailure(error: unknown): string {
  if (!(error instanceof Error)) return "operation_failed";
  return error.message
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/(?:token|secret|password)\s*[:=]\s*\S+/gi, "[redacted-secret]")
    .slice(0, 300);
}

export function healthAgentLedgerRunId(workflowRunId: string): string {
  const runId = workflowRunId.trim();
  if (!runId) throw new Error("invalid_workflow_run_id");
  return `gha:${runId}`;
}

function optionalDeliveryWarning(
  code: string,
  operation: string,
  error: unknown,
): HealthDeliveryWarning {
  return {
    category: "optional_delivery",
    code,
    operation,
    reason: safeRuntimeFailure(error),
  };
}

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;
type RuntimeFiles = JsonFileStore | ArtifactFileSystem;
type JsonObject = Record<string, JsonValue>;

export const WORKFLOW_RUNTIME_COMMANDS = [
  "admit-run",
  "collect-cron-health",
  "collect-link",
  "collect-brand-review",
  "collect-trail-supply",
  "collect-directory-evidence",
  "collect-sentry",
  "classify-sentry",
  "combine-sentry",
  "evaluate-directory",
  "aggregate-and-deliver",
  "final-report",
  "finalize-run",
  "record-artifact-upload",
  "terminal-status",
  "cleanup-stale-branches",
  "release-claims",
  "enqueue-and-claim",
  "repair-snapshot",
  "repair-metadata",
  "repair-audit",
  "repair-result",
  "repair-failure",
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
  agentHubWriter?: (envelope: unknown) => Promise<unknown>;
  auditRecords?: AuditRecord[];
  fetchImplementation?: typeof fetch;
  isAncestor?: (tipSha: string, mainSha: string) => Promise<boolean>;
}

export interface RuntimeDependencyOptions {
  agentHubWriter?: (envelope: unknown) => Promise<unknown>;
  audit?: AuditLogger;
  auditRecords?: AuditRecord[];
  env?: RuntimeEnvironment;
  fetchImplementation?: typeof fetch;
  files?: JsonFileStore;
}

export interface SanitizedSentryArtifact {
  candidateIssueCount: number;
  classificationsRequired: number;
  /**
   * Why collection failed. Only set when `status` is "failed" — a failed
   * collector and a genuinely clean Sentry both produce `issues: []`, and
   * without this field the two are indistinguishable downstream.
   */
  failure?: string;
  hasMore: boolean;
  incidentMode: boolean;
  /**
   * Distinct error codes from issues whose latest-event enrichment was skipped.
   * Present only on a degraded-but-successful collection.
   */
  latestEventFailures?: string[];
  issues: SanitizedSentryCandidate[];
  requestCount: number;
  status?: "failed" | "success";
  version: 1;
}

interface BrandReviewArtifact {
  collectedAt: string;
  evidence: Record<string, unknown>;
  failure?: string;
  failures: string[];
  findings: HealthFinding[];
  routine: string;
  skippedActions: string[];
  snapshot?: Record<string, unknown>;
  status: "failed" | "skipped" | "success";
  version: 1;
}

interface BrandReviewLedgerClaim {
  claimed: boolean;
  replay: boolean;
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
  brandReviewArtifactPath?: string;
  cronArtifactPath?: string;
  deferDelivery?: boolean;
  directoryArtifactPath: string;
  exhaustedAutomationFingerprints?: readonly string[];
  linkArtifactPath: string;
  mode: "canary_fix" | "live" | "preflight";
  outputPath: string;
  qualityArtifactPath?: string;
  prOutcomes?: readonly JsonValue[];
  runAt: string;
  sentryArtifactPath: string;
  workflowAttempt: number;
  workflowRunId: string;
  workflowUrl?: string;
}

export interface FinalReportInput {
  aggregateArtifactPath?: string;
  automaticPrResultPath?: string;
  deferDelivery?: boolean;
  humanPrResultPath?: string;
  mode: "canary_fix" | "live" | "preflight";
  outputPath: string;
  phases: HealthSummary["phases"];
  queueArtifactPath?: string;
  runAt: string;
  workflowAttempt: number;
  workflowRunId: string;
  workflowUrl?: string;
}

export interface AdmissionInput {
  mode: "canary_fix" | "live" | "preflight";
  outputPath: string;
  runAt: string;
  terminalOutputPath?: string;
  workflowAttempt: number;
  workflowRunId: string;
}

export interface FinalizeAdmissionInput {
  mode: "canary_fix" | "live" | "preflight";
  outputPath: string;
  resultPath?: string;
  runAt: string;
  status: "failed" | "success";
  workflowAttempt: number;
  workflowRunId: string;
}

export interface ArtifactUploadInput {
  inputPath: string;
  outputPath: string;
  reason?: string;
  status: "failed" | "success";
}

export interface TerminalStatusDecisionInput {
  artifactStatus: string;
  finalReportStatus: string;
  managerReportStatus: string;
  uploadClassifierStatus: string;
  uploadRetryStatus: string;
  uploadStatus: string;
}

export interface TerminalStatusInput extends TerminalStatusDecisionInput {
  outputPath: string;
}

export interface QueueWorkflowInput {
  canaryFingerprints?: readonly string[];
  findingsArtifactPath: string;
  leaseOwner: string;
  mode: "canary_fix" | "live" | "preflight";
  outputPath: string;
}

export interface StaleBranchCleanupInput {
  aggregateArtifactPath: string;
  canaryFingerprints?: readonly string[];
  mode: "canary_fix" | "live" | "preflight";
  outputPath: string;
  runAt: string;
  runIdentity: string;
  workflowAttempt: number;
  workflowRunId: string;
}

export interface StaleBranchCleanupOutcome {
  branch: string;
  deletedTipSha?: string;
  fingerprint: string;
  outcome: "deleted" | "skipped";
  reason?: string;
  recordedTipSha: string;
}

export interface StaleBranchCleanupResult {
  delivery?: {
    agentHub: "fulfilled" | "rejected";
    slack: "fulfilled" | "rejected";
  };
  mode: StaleBranchCleanupInput["mode"];
  outcomes: StaleBranchCleanupOutcome[];
  runIdentity: string;
  version: 1;
}

export interface RepairSnapshotInput {
  batchKind?: "automatic" | "human" | "manager";
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
  deferDelivery?: boolean;
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

export interface RepairFailureInput {
  deferDelivery?: boolean;
  expectedEscalation?: boolean;
  leaseOwner: string;
  mergePolicy: "automatic" | "human";
  metadataPath: string;
  outputPath: string;
  reason?: string;
  runAt: string;
  snapshotPath: string;
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
  issues: readonly SanitizedSentryCandidate[];
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

export function safePhaseStatus(
  value: unknown,
): "failed" | "skipped" | "success" {
  if (value === "failed" || value === "failure" || value === "cancelled") {
    return "failed";
  }
  return value === "success" ? value : "skipped";
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
  "rearm_health_fix_canary",
  "record_health_snapshot",
  "record_link_health_result",
  "reconcile_health_fix_lifecycle",
  "release_health_fix_claims",
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
    claim: async (policy, leaseOwner, fingerprints) => {
      const value = await supabaseRequest(
        dependencies,
        "claim_health_fixes",
        "/rest/v1/rpc/claim_health_fixes",
        "HEALTH_AGENT_WRITER_TOKEN",
        {
          body: JSON.stringify({
            p_fingerprints: fingerprints,
            p_lease_duration: "30 minutes",
            p_lease_owner: leaseOwner,
            p_merge_policy: policy,
          }),
          method: "POST",
        },
        (candidate) => Array.isArray(candidate),
      );
      return (value as unknown[]).filter(isRecord).map((candidate) => {
        const finding = repairFindingFromValue(candidate);
        const claimedFindingId =
          finding.claimedFindingId ??
          (typeof candidate.id === "string" ? candidate.id : undefined);
        return claimedFindingId ? { ...finding, claimedFindingId } : finding;
      });
    },
    rearmCanary: async (fingerprint) =>
      supabaseRequest(
        dependencies,
        "rearm_health_fix_canary",
        "/rest/v1/rpc/rearm_health_fix_canary",
        "HEALTH_AGENT_WRITER_TOKEN",
        {
          body: JSON.stringify({ p_fingerprint: fingerprint }),
          method: "POST",
        },
        (candidate) => Array.isArray(candidate),
      ),
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
    listFingerprintStates: async (fingerprints) => {
      if (fingerprints.length === 0) return [];
      const batches = Array.from(
        {
          length: Math.ceil(fingerprints.length / FINGERPRINT_STATE_BATCH_SIZE),
        },
        (_, index) =>
          fingerprints.slice(
            index * FINGERPRINT_STATE_BATCH_SIZE,
            (index + 1) * FINGERPRINT_STATE_BATCH_SIZE,
          ),
      );
      const values = await Promise.all(
        batches.map((batch) => {
          const params = new URLSearchParams({
            fingerprint: `in.(${batch.join(",")})`,
            order: "created_at.desc",
            select: "fingerprint,status",
          });
          return supabaseRequest(
            dependencies,
            "list_health_fingerprint_states",
            `/rest/v1/health_fix_queue?${params.toString()}`,
            "HEALTH_AGENT_READER_TOKEN",
            { method: "GET" },
            (candidate) => Array.isArray(candidate),
          );
        }),
      );
      const states = values
        .flatMap((value) => value as unknown[])
        .flatMap((candidate) => {
          if (!isRecord(candidate)) return [];
          return typeof candidate.fingerprint === "string" &&
            typeof candidate.status === "string"
            ? [{ fingerprint: candidate.fingerprint, status: candidate.status }]
            : [];
        });
      const seen = new Set<string>();
      return states.filter(({ fingerprint }) => {
        if (seen.has(fingerprint)) return false;
        seen.add(fingerprint);
        return true;
      });
    },
    // "Needs a Linear ticket" is exactly ticketed_at IS NULL on a row in an
    // active status. Lifecycle "new" is not a substitute: it means "no active
    // queue row", which is wrong for skipped rows and for automatic-policy
    // rows that were enqueued but never ticketed.
    listUnticketedFingerprints: async (fingerprints) => {
      if (fingerprints.length === 0) return [];
      const batches = fingerprintBatches(fingerprints);
      const values = await Promise.all(
        batches.map((batch) => {
          const params = new URLSearchParams({
            fingerprint: `in.(${batch.join(",")})`,
            order: "created_at.desc",
            select: "fingerprint,status,ticketed_at",
            status: `in.(${ACTIVE_QUEUE_STATUSES.join(",")})`,
            ticketed_at: "is.null",
          });
          return supabaseRequest(
            dependencies,
            "list_unticketed_health_fingerprints",
            `/rest/v1/health_fix_queue?${params.toString()}`,
            "HEALTH_AGENT_READER_TOKEN",
            { method: "GET" },
            (candidate) => Array.isArray(candidate),
          );
        }),
      );
      const seen = new Set<string>();
      return values
        .flatMap((value) => value as unknown[])
        .flatMap((candidate) => {
          if (!isRecord(candidate)) return [];
          if (typeof candidate.fingerprint !== "string") return [];
          if (candidate.ticketed_at !== null) return [];
          if (seen.has(candidate.fingerprint)) return [];
          seen.add(candidate.fingerprint);
          return [candidate.fingerprint];
        });
    },
    reserveTicketCandidates: async (fingerprints, reservationIdentifier) => {
      if (fingerprints.length === 0) return;
      const reservation = reservationIdentifier.trim();
      if (!reservation) throw new Error("linear_reservation_required");
      const ticketedAt = new Date().toISOString();
      const values = await Promise.all(
        fingerprintBatches(fingerprints).map((batch) => {
          const params = new URLSearchParams({
            fingerprint: `in.(${batch.join(",")})`,
            linear_identifier: "is.null",
            select: "fingerprint",
            status: `in.(${ACTIVE_QUEUE_STATUSES.join(",")})`,
            ticketed_at: "is.null",
          });
          return supabaseRequest(
            dependencies,
            "reserve_health_fingerprint_tickets",
            `/rest/v1/health_fix_queue?${params.toString()}`,
            "HEALTH_AGENT_WRITER_TOKEN",
            {
              body: JSON.stringify({
                linear_identifier: reservation,
                ticketed_at: ticketedAt,
              }),
              headers: { Prefer: "return=representation" },
              method: "PATCH",
            },
            (candidate) => Array.isArray(candidate),
          );
        }),
      );
      const reserved = new Set(
        values
          .flatMap((value) => recordRows(value))
          .flatMap((row) =>
            typeof row.fingerprint === "string" ? [row.fingerprint] : [],
          ),
      );
      if (
        new Set(fingerprints).size !== reserved.size ||
        fingerprints.some((fingerprint) => !reserved.has(fingerprint))
      ) {
        throw new Error("linear_reservation_incomplete");
      }
    },
    finalizeTicketReservation: async (
      fingerprints,
      reservationIdentifier,
      linearIdentifier,
    ) => {
      if (fingerprints.length === 0) return;
      const reservation = reservationIdentifier.trim();
      const identifier = linearIdentifier.trim();
      if (!reservation) throw new Error("linear_reservation_required");
      if (!identifier) throw new Error("linear_identifier_required");
      const values = await Promise.all(
        fingerprintBatches(fingerprints).map((batch) => {
          const params = new URLSearchParams({
            fingerprint: `in.(${batch.join(",")})`,
            linear_identifier: `eq.${reservation}`,
            select: "fingerprint",
            status: `in.(${ACTIVE_QUEUE_STATUSES.join(",")})`,
          });
          return supabaseRequest(
            dependencies,
            "finalize_health_fingerprint_tickets",
            `/rest/v1/health_fix_queue?${params.toString()}`,
            "HEALTH_AGENT_WRITER_TOKEN",
            {
              body: JSON.stringify({ linear_identifier: identifier }),
              headers: { Prefer: "return=representation" },
              method: "PATCH",
            },
            (candidate) => Array.isArray(candidate),
          );
        }),
      );
      const finalized = new Set(
        values
          .flatMap((value) => recordRows(value))
          .flatMap((row) =>
            typeof row.fingerprint === "string" ? [row.fingerprint] : [],
          ),
      );
      if (
        new Set(fingerprints).size !== finalized.size ||
        fingerprints.some((fingerprint) => !finalized.has(fingerprint))
      ) {
        throw new Error("linear_reservation_finalize_incomplete");
      }
    },
    releaseTicketReservation: async (fingerprints, reservationIdentifier) => {
      if (fingerprints.length === 0) return;
      const reservation = reservationIdentifier.trim();
      if (!reservation) throw new Error("linear_reservation_required");
      const values = await Promise.all(
        fingerprintBatches(fingerprints).map((batch) => {
          const params = new URLSearchParams({
            fingerprint: `in.(${batch.join(",")})`,
            linear_identifier: `eq.${reservation}`,
            select: "fingerprint",
            status: `in.(${ACTIVE_QUEUE_STATUSES.join(",")})`,
          });
          return supabaseRequest(
            dependencies,
            "release_health_fingerprint_ticket_reservation",
            `/rest/v1/health_fix_queue?${params.toString()}`,
            "HEALTH_AGENT_WRITER_TOKEN",
            {
              body: JSON.stringify({
                linear_identifier: null,
                ticketed_at: null,
              }),
              headers: { Prefer: "return=representation" },
              method: "PATCH",
            },
            (candidate) => Array.isArray(candidate),
          );
        }),
      );
      const released = new Set(
        values
          .flatMap((value) => recordRows(value))
          .flatMap((row) =>
            typeof row.fingerprint === "string" ? [row.fingerprint] : [],
          ),
      );
      if (
        new Set(fingerprints).size !== released.size ||
        fingerprints.some((fingerprint) => !released.has(fingerprint))
      ) {
        throw new Error("linear_reservation_release_incomplete");
      }
    },
    markFingerprintsTicketed: async (fingerprints, linearIdentifier) => {
      if (fingerprints.length === 0) return;
      const identifier = linearIdentifier.trim();
      if (!identifier) throw new Error("linear_identifier_required");
      const batches = Array.from(
        {
          length: Math.ceil(fingerprints.length / FINGERPRINT_STATE_BATCH_SIZE),
        },
        (_, index) =>
          fingerprints.slice(
            index * FINGERPRINT_STATE_BATCH_SIZE,
            (index + 1) * FINGERPRINT_STATE_BATCH_SIZE,
          ),
      );
      await Promise.all(
        batches.map((batch) => {
          // The ticketed_at=is.null filter is what makes a partially failed
          // run safe to repeat: already-stamped rows are never restamped.
          const params = new URLSearchParams({
            fingerprint: `in.(${batch.join(",")})`,
            status: `in.(${ACTIVE_QUEUE_STATUSES.join(",")})`,
            ticketed_at: "is.null",
          });
          return supabaseRequest(
            dependencies,
            "mark_health_fingerprints_ticketed",
            `/rest/v1/health_fix_queue?${params.toString()}`,
            "HEALTH_AGENT_WRITER_TOKEN",
            {
              body: JSON.stringify({
                linear_identifier: identifier,
                ticketed_at: new Date().toISOString(),
              }),
              headers: { Prefer: "return=minimal" },
              method: "PATCH",
            },
            (candidate) => candidate === null || Array.isArray(candidate),
          );
        }),
      );
    },
    reconcileFingerprintLifecycle: async (
      observedFingerprints,
      completedSources,
    ) => {
      const value = await supabaseRequest(
        dependencies,
        "reconcile_health_fix_lifecycle",
        "/rest/v1/rpc/reconcile_health_fix_lifecycle",
        "HEALTH_AGENT_WRITER_TOKEN",
        {
          body: JSON.stringify({
            p_observed_fingerprints: observedFingerprints,
            p_completed_sources: completedSources,
          }),
          method: "POST",
        },
        (candidate) => Array.isArray(candidate),
      );
      const fixedFingerprints: string[] = [];
      const failedVerificationFingerprints: string[] = [];
      const regressedFingerprints: string[] = [];
      const verifiedSentryAbsences: Array<{
        fingerprint: string;
        id: string;
        issueId: string;
        status: string;
      }> = [];
      for (const candidate of value as unknown[]) {
        if (!isRecord(candidate) || typeof candidate.fingerprint !== "string")
          continue;
        if (candidate.reconciliation === "fixed") {
          fixedFingerprints.push(candidate.fingerprint);
        } else if (candidate.reconciliation === "failed_verification") {
          failedVerificationFingerprints.push(candidate.fingerprint);
        } else if (candidate.reconciliation === "regressed") {
          regressedFingerprints.push(candidate.fingerprint);
        }
        if (
          candidate.reconciliation === "verified_sentry_absence" &&
          typeof candidate.id === "string" &&
          typeof candidate.sentry_issue_id === "string" &&
          typeof candidate.current_status === "string"
        ) {
          verifiedSentryAbsences.push({
            fingerprint: candidate.fingerprint,
            id: candidate.id,
            issueId: candidate.sentry_issue_id,
            status: candidate.current_status,
          });
        }
      }
      return {
        failedVerificationFingerprints,
        fixedFingerprints,
        regressedFingerprints,
        verifiedSentryAbsences,
      };
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

function isIsoDateValue(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function brandReviewLedgerClaim(value: unknown): BrandReviewLedgerClaim {
  if (!isRecord(value) || typeof value.claimed !== "boolean") {
    throw new Error("brand_review_ledger_claim_invalid");
  }
  return {
    claimed: value.claimed,
    replay: value.replay === true,
  };
}

function successfulBooleanRpcResult(value: unknown): boolean {
  return (
    value === true ||
    (Array.isArray(value) && value.length === 1 && value[0] === true)
  );
}

function duplicateTerminalReport(
  input: AdmissionInput,
  replay: boolean,
): JsonObject {
  const envelope: HealthAgentEnvelope = {
    data: {
      admission: replay ? "replay" : "duplicate",
      detector_failures: [],
      delivery_warnings: [],
      failures: [],
      infrastructure_failures: [],
      notification_owner: "github_actions",
      overall_status: "healthy",
    },
    date: taipeiDate(input.runAt),
    project: "formoria",
    routine: "health-agent",
    run_at: input.runAt,
    source: "github_actions",
    source_run_id: `github-actions:health-agent:${input.workflowRunId}:${input.workflowAttempt}`,
    status: "success",
    tickets_created: [],
    verdict_severity: "ok",
    verdict_text: replay
      ? "Health Agent replay already completed for this logical day."
      : "Health Agent duplicate invocation was admitted previously.",
    version: 1,
  };
  return {
    agent_hub: "skipped",
    delivery_warnings: [],
    envelope: envelope as unknown as JsonValue,
    infrastructure_failures: [],
    slack: "skipped",
    terminal: true,
    version: 1,
  };
}

export async function admitHealthAgentRun(
  input: AdmissionInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<JsonObject> {
  const files = filesFor(dependencies);
  const requestedRunId = healthAgentLedgerRunId(input.workflowRunId);
  const claim =
    input.mode === "live"
      ? brandReviewLedgerClaim(
          await supabaseRequest(
            dependencies,
            "claim_health_agent_run",
            "/rest/v1/rpc/claim_health_agent_run",
            "HEALTH_AGENT_WRITER_TOKEN",
            {
              body: JSON.stringify({
                p_dry_run: false,
                p_logical_date: taipeiDate(input.runAt),
                p_requested_run_id: requestedRunId,
                p_routine: "health-agent",
                p_workflow_attempt: input.workflowAttempt,
              }),
              method: "POST",
            },
            (value) => isRecord(value) && typeof value.claimed === "boolean",
          ),
        )
      : { claimed: true, replay: false };
  const result: JsonObject = {
    claimed: claim.claimed,
    logical_date: taipeiDate(input.runAt),
    replay: claim.replay,
    requested_run_id: requestedRunId,
    routine: "health-agent",
    status: claim.claimed ? "admitted" : "duplicate",
    terminal: !claim.claimed,
    version: 1,
  };
  await writeRedactedJson(input.outputPath, result, files);
  if (!claim.claimed && input.terminalOutputPath) {
    await writeRedactedJson(
      input.terminalOutputPath,
      duplicateTerminalReport(input, claim.replay),
      files,
    );
  }
  return result;
}

export async function finalizeHealthAgentRun(
  input: FinalizeAdmissionInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<JsonObject> {
  const fallbackResult = {
    error: "health_agent_terminal_delivery_failed",
    status: "failed",
    terminal: true,
    version: 1,
  };
  let finalStatus = input.status;
  let resultValue: unknown = fallbackResult;
  if (input.status === "success" && input.resultPath) {
    try {
      const loaded = await readBoundedJson(
        input.resultPath,
        filesFor(dependencies),
      );
      if (isRecord(loaded)) {
        resultValue = loaded;
      } else {
        finalStatus = "failed";
      }
    } catch {
      finalStatus = "failed";
    }
  } else if (input.status === "success") {
    finalStatus = "failed";
  }
  const requestedRunId = healthAgentLedgerRunId(input.workflowRunId);
  let finalized = true;
  if (input.mode === "live") {
    const body = {
      p_logical_date: taipeiDate(input.runAt),
      p_requested_run_id: requestedRunId,
      p_result: objectValue(resultValue),
      p_routine: "health-agent",
      p_workflow_attempt: input.workflowAttempt,
    };
    if (finalStatus === "success") {
      finalized = successfulBooleanRpcResult(
        await supabaseRequest(
          dependencies,
          "complete_health_agent_run",
          "/rest/v1/rpc/complete_health_agent_run",
          "HEALTH_AGENT_WRITER_TOKEN",
          { body: JSON.stringify(body), method: "POST" },
          (value) => successfulBooleanRpcResult(value),
        ),
      );
    } else {
      finalized = successfulBooleanRpcResult(
        await supabaseRequest(
          dependencies,
          "fail_health_agent_run",
          "/rest/v1/rpc/fail_health_agent_run",
          "HEALTH_AGENT_WRITER_TOKEN",
          {
            body: JSON.stringify({
              ...body,
              p_error: "health_agent_terminal_delivery_failed",
            }),
            method: "POST",
          },
          (value) => successfulBooleanRpcResult(value),
        ),
      );
    }
  }
  const result: JsonObject = {
    finalized,
    logical_date: taipeiDate(input.runAt),
    requested_run_id: requestedRunId,
    routine: "health-agent",
    status: finalStatus,
    version: 1,
  };
  await writeRedactedJson(input.outputPath, result, filesFor(dependencies));
  return result;
}

export async function recordArtifactUploadOutcome(
  input: ArtifactUploadInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<JsonObject> {
  let artifact: unknown = {};
  let readFailure: string | undefined;
  try {
    artifact = await readBoundedJson(input.inputPath, filesFor(dependencies));
  } catch (error) {
    readFailure = safeRuntimeFailure(error);
  }
  const base = isRecord(artifact) ? artifact : {};
  const existingFailures: JsonValue[] = Array.isArray(
    base.infrastructure_failures,
  )
    ? base.infrastructure_failures.map((failure) => redactForAudit(failure))
    : [];
  const failed = input.status === "failed" || readFailure !== undefined;
  const failure: HealthInfrastructureFailure = {
    category: "infrastructure",
    code:
      input.status === "failed"
        ? "health_run_artifact_upload_failed"
        : "health_run_artifact_invalid",
    operation: "upload_artifact",
    reason:
      input.reason?.trim().slice(0, 300) ||
      readFailure ||
      "health_run_artifact_upload_failed",
  };
  const result = {
    ...base,
    artifact_delivery: {
      ...(failed ? { code: failure.code, reason: failure.reason } : {}),
      operation: "upload_artifact",
      status: failed ? "failed" : "success",
    },
    ...(failed
      ? { infrastructure_failures: [...existingFailures, failure] }
      : {}),
  };
  await writeRedactedJson(input.outputPath, result, filesFor(dependencies));
  return objectValue(result);
}

export function decideTerminalStatus(
  input: TerminalStatusDecisionInput,
): "failed" | "success" {
  const uploadSucceeded =
    input.uploadStatus === "success" || input.uploadRetryStatus === "success";
  return input.finalReportStatus === "success" &&
    input.managerReportStatus === "success" &&
    input.artifactStatus === "success" &&
    uploadSucceeded &&
    input.uploadClassifierStatus === "success"
    ? "success"
    : "failed";
}

export async function writeTerminalStatus(
  input: TerminalStatusInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<JsonObject> {
  const result: JsonObject = {
    artifact_status: input.artifactStatus,
    final_report_status: input.finalReportStatus,
    manager_report_status: input.managerReportStatus,
    status: decideTerminalStatus(input),
    upload_classifier_status: input.uploadClassifierStatus,
    upload_retry_status: input.uploadRetryStatus,
    upload_status: input.uploadStatus,
    version: 1,
  };
  await writeRedactedJson(input.outputPath, result, filesFor(dependencies));
  return result;
}

async function supabaseRows(
  dependencies: WorkflowRuntimeDependencies,
  resource: string,
  select: string,
  operation: string,
  filters: Readonly<Record<string, string>> = {},
  order = "id",
): Promise<Record<string, unknown>[]> {
  const query = new URLSearchParams({ order, select, ...filters });
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

function nullableBrandString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function brandMitStatus(value: unknown): RecentBrandEdit["mitStatus"] {
  return value === "unverified" || value === "declared" || value === "verified"
    ? value
    : null;
}

function brandMitDeclaredScope(
  value: unknown,
): RecentBrandEdit["mitDeclaredScope"] {
  return value === "all" || value === "most" || value === "some" ? value : null;
}

function brandOtherUrls(value: unknown): RecentBrandEdit["otherUrls"] {
  let candidate: unknown = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(candidate)) return null;
  return candidate.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.label !== "string" ||
      typeof entry.url !== "string"
    ) {
      return [];
    }
    return [{ label: entry.label, url: entry.url }];
  });
}

/** Every online store's camelCase field, derived from the registry. */
function onlineStoreFields(
  row: Record<string, unknown>,
): Record<OnlineStoreCamelField, string | null> {
  return Object.fromEntries(
    ONLINE_STORES.map((channel) => [
      channel.camel,
      nullableBrandString(row[channel.column]),
    ]),
  ) as Record<OnlineStoreCamelField, string | null>;
}

function recentBrandEdit(row: Record<string, unknown>): RecentBrandEdit {
  return {
    description: nullableBrandString(row.description),
    descriptionEn: nullableBrandString(row.description_en),
    id: safeString(row.id, "brand.id"),
    mitDeclaredAt: nullableBrandString(row.mit_declared_at),
    mitDeclaredScope: brandMitDeclaredScope(row.mit_declared_scope),
    mitStatus: brandMitStatus(row.mit_status),
    mitVerifiedAt: nullableBrandString(row.mit_verified_at),
    name: safeString(row.name, "brand.name"),
    otherUrls: brandOtherUrls(row.other_urls),
    ...onlineStoreFields(row),
    socialFacebook: nullableBrandString(row.social_facebook),
    socialInstagram: nullableBrandString(row.social_instagram),
    socialThreads: nullableBrandString(row.social_threads),
  };
}

async function collectBrandReview(
  input: {
    deferDelivery?: boolean;
    mode: string;
    mutate: boolean;
    outputPath: string;
    runAt: string;
    windowHours?: number;
    workflowRunId: string;
    workflowAttempt: string;
  },
  dependencies: WorkflowRuntimeDependencies,
): Promise<void> {
  const files = filesFor(dependencies);
  try {
    const windowHours = input.windowHours ?? 25;
    const windowStart = new Date(
      new Date(input.runAt).getTime() - windowHours * 3600_000,
    ).toISOString();
    if (input.mode === "preflight") {
      const artifact: BrandReviewArtifact = {
        collectedAt: input.runAt,
        evidence: { mode: input.mode },
        failures: [],
        findings: [],
        routine: "brand-review",
        skippedActions: ["brand_review_collection"],
        status: "skipped",
        version: 1,
      };
      await writeRedactedJson(input.outputPath, artifact, files);
      return;
    }

    const rows = await supabaseRows(
      dependencies,
      "brands",
      `id,name,description,description_en,mit_status,mit_declared_scope,mit_declared_at,mit_verified_at,${ONLINE_STORE_COLUMNS.join(",")},social_instagram,social_threads,social_facebook,other_urls`,
      "brand_review_query",
      { status: "eq.approved", updated_at: `gte.${windowStart}` },
    );
    const brands = rows.map(recentBrandEdit);
    const evaluated = evaluateBrandReview(brands, input.runAt, windowStart);
    const artifact: BrandReviewArtifact = {
      collectedAt: input.runAt,
      evidence: {
        mode: input.mode,
        source: "recent_approved_brand_edits",
        windowHours,
      },
      failures: [],
      findings: evaluated.findings,
      routine: "brand-review",
      skippedActions:
        input.mode === "live" && !input.mutate ? ["brand_review_delivery"] : [],
      snapshot: { ...evaluated.snapshot },
      status: "success",
      version: 1,
    };
    await writeRedactedJson(input.outputPath, artifact, files);

    if (input.mode !== "live" || !input.mutate) return;

    const requestedRunId = healthAgentLedgerRunId(input.workflowRunId);
    const ledgerBody = {
      p_routine: "brand-review",
      p_logical_date: taipeiDate(input.runAt),
      p_requested_run_id: requestedRunId,
      p_workflow_attempt: Number(input.workflowAttempt),
    };
    const claim = brandReviewLedgerClaim(
      await supabaseRequest(
        dependencies,
        "claim_health_agent_run",
        "/rest/v1/rpc/claim_health_agent_run",
        "HEALTH_AGENT_WRITER_TOKEN",
        {
          method: "POST",
          body: JSON.stringify(ledgerBody),
        },
        (value) => isRecord(value) && typeof value.claimed === "boolean",
      ),
    );
    if (!claim.claimed) {
      await writeRedactedJson(
        input.outputPath,
        {
          ...artifact,
          skippedActions: [
            claim.replay ? "brand_review_replay" : "brand_review_in_progress",
          ],
        },
        files,
      );
      return;
    }

    if (evaluated.findings.length > 0) {
      const delivery = dependencies.delivery;
      if (!input.deferDelivery) {
        if (!delivery) throw new Error("brand_review_delivery_unavailable");
        const report: SlackDigestInput = {
          actionableFindings: evaluated.findings,
          failures: [],
          linearOutcomes: [],
          prOutcomes: [],
          skippedActions: [],
        };
        await delivery.slack(report);
      }
      await Promise.all(
        evaluated.findings.map((finding) =>
          supabaseRequest(
            dependencies,
            "enqueue_health_fix",
            "/rest/v1/rpc/enqueue_health_fix",
            "HEALTH_AGENT_WRITER_TOKEN",
            {
              body: JSON.stringify({
                p_evidence: JSON.stringify(finding.evidence),
                p_fingerprint: finding.fingerprint,
                p_merge_policy: finding.mergePolicy,
                p_source: finding.source,
                p_title: finding.title,
              }),
              method: "POST",
            },
            (candidate) =>
              typeof candidate === "string" ||
              (Array.isArray(candidate) && candidate.length <= 1),
          ),
        ),
      );
    }

    await supabaseRequest(
      dependencies,
      "complete_health_agent_run",
      "/rest/v1/rpc/complete_health_agent_run",
      "HEALTH_AGENT_WRITER_TOKEN",
      {
        method: "POST",
        body: JSON.stringify({
          ...ledgerBody,
          p_result: {
            finding_count: evaluated.findings.length,
            reviewed_count: evaluated.snapshot.reviewedCount,
            window_start_iso: evaluated.snapshot.windowStartIso,
          },
        }),
      },
      successfulBooleanRpcResult,
    );
  } catch (error) {
    const failure =
      error instanceof Error ? error.message : "brand_review_collection_failed";
    const artifact: BrandReviewArtifact = {
      collectedAt: input.runAt,
      evidence: {},
      failure,
      failures: [failure],
      findings: [],
      routine: "brand-review",
      skippedActions: [],
      status: "failed",
      version: 1,
    };
    await writeRedactedJson(input.outputPath, artifact, files);
  }
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
  const normalizedDeadTupleSnapshots = deadTupleSnapshots
    .flatMap((value) => {
      const snapshotDate = stringValue(
        value.snapshotDate ?? value.snapshot_date,
      );
      const tables = Array.isArray(value.tables)
        ? value.tables.filter(isRecord).flatMap((table) => {
            const tableName = stringValue(table.tableName ?? table.table_name);
            return tableName
              ? [
                  {
                    autovacuumThreshold: numberValue(
                      table.autovacuumThreshold ?? table.autovacuum_threshold,
                    ),
                    deadTuples: numberValue(
                      table.deadTuples ?? table.dead_tuples,
                    ),
                    deadTuplePercent: numberValue(
                      table.deadTuplePercent ?? table.dead_tuple_percent,
                    ),
                    liveTuples: numberValue(
                      table.liveTuples ?? table.live_tuples,
                    ),
                    tableName,
                  },
                ]
              : [];
          })
        : [];
      return snapshotDate ? [{ snapshotDate, tables }] : [];
    })
    .filter((snapshot) => isIsoDateValue(snapshot.snapshotDate))
    .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate))
    .slice(-2);
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
    deadTupleSnapshots: normalizedDeadTupleSnapshots,
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
    return [
      {
        alertId,
        packageName,
        severity,
        state: "open",
        versionImpact: "unknown",
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
  const audit = auditFor(dependencies);
  let writer = dependencies.agentHubWriter;
  return createAgentHubAdapter({
    audit,
    runner: async (envelope) => {
      const startedAt = performance.now();
      const request = {
        envelope: objectValue(envelope),
        method: "agent_hub_delivery",
      };
      let responseRecorded = false;
      try {
        if (!writer) {
          writer = createAgentHubDelivery({
            env: environment,
            supabaseOptions: {
              fetchImplementation: fetchFor(dependencies),
            },
            logger: (record: unknown) => {
              const value = isRecord(record) ? record : {};
              const destination =
                typeof value.destination === "string"
                  ? value.destination
                  : "unknown";
              const status = value.status === "success" ? "success" : "failure";
              audit({
                adapter: `agent-hub-${destination}`,
                latencyMs:
                  typeof value.latency_ms === "number" &&
                  Number.isFinite(value.latency_ms)
                    ? Math.max(0, Math.round(value.latency_ms))
                    : 0,
                operation:
                  typeof value.operation === "string"
                    ? value.operation
                    : "deliver",
                request: {
                  destination,
                  mode: typeof value.mode === "string" ? value.mode : "unknown",
                  source_run_id:
                    typeof value.source_run_id === "string"
                      ? value.source_run_id
                      : "",
                },
                response: objectValue(
                  value.response ??
                    (typeof value.error === "string"
                      ? { error: value.error }
                      : {}),
                ),
                schemaValid: status === "success",
                status,
              });
            },
          });
        }
        const body = await writer(envelope);
        const schemaValid =
          isRecord(body) &&
          typeof body.duplicate === "boolean" &&
          typeof body.run_id === "string";
        audit({
          adapter: "agent-hub-runtime",
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          operation: "ingest_envelope",
          request,
          response: {
            mode:
              typeof environment.AGENT_HUB_DELIVERY_MODE === "string"
                ? environment.AGENT_HUB_DELIVERY_MODE
                : "injected",
            result: objectValue(body),
          },
          schemaValid,
          status: schemaValid ? "success" : "failure",
        });
        responseRecorded = true;
        if (!schemaValid) {
          throw new Error("agent_hub_runtime_request_failed");
        }
        return body;
      } catch (error) {
        if (!responseRecorded) {
          audit({
            adapter: "agent-hub-runtime",
            latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
            operation: "ingest_envelope",
            request,
            response: { error: "request_failed" },
            schemaValid: false,
            status: "failure",
          });
        }
        throw error;
      }
    },
  });
}

export function createWorkflowRuntimeDependencies(
  options: RuntimeDependencyOptions = {},
): WorkflowRuntimeDependencies {
  const records = options.auditRecords ?? [];
  const audit = options.audit ?? createWorkflowAudit(records).audit;
  const dependencies: WorkflowRuntimeDependencies = {
    agentHubWriter: options.agentHubWriter,
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
      apiKey: requiredEnvironment(environment, "LINEAR_OAUTH_ACCESS_TOKEN"),
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
      fingerprint: `link:link-cleanup:${cleanup.brandId}:${cleanup.field}`,
      humanReason: "Link, image, and brand-field cleanup are human-owned",
      mergePolicy: "human",
      severity: "medium",
      source: "link",
      title: "Link cleanup requires review",
    }),
  );
  const findingsByFingerprint = new Map(
    cleanupFindings.map((finding) => [finding.fingerprint, finding]),
  );
  for (const finding of evaluated.findings) {
    findingsByFingerprint.set(finding.fingerprint, finding);
  }
  const findings = [...findingsByFingerprint.values()].sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  );
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
            dryRun: input.mode !== "live",
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
            // Without this the link collector is the one caller that never
            // supplies an audit logger, so `emitAudit` inside
            // executeLinkHealthRequest is a no-op — including the failure record
            // that carries the HTTP status. The workflow passes `--audit` for
            // this collector and got an empty file, which is why six nights of
            // failures could not be told apart and why an HTTP 401 here was
            // indistinguishable from a malformed response (DEV-1381). Every
            // other collector already threads it the same way.
            audit: auditFor(dependencies),
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
  } catch (error) {
    // Keep the error's class in the reason. A bare `catch {}` here reported every
    // cause as the same opaque `link_collection_failed`, which is why a run that
    // had already failed for six nights still could not be diagnosed from the
    // uploaded artifact — a network fault, a timeout, and an invalid summary were
    // indistinguishable (DEV-1381). `safeErrorCode` returns only `error.name`,
    // never the message, and `failedCollectorArtifact` redacts on top, so no URL
    // or credential can reach the artifact. Matches how the sentry collector and
    // `invalid_link_artifact` already report their failures.
    artifact = failedCollectorArtifact(
      "link-checker",
      runAt,
      `${safeErrorCode(error)}:link_collection_failed`,
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
  const issues = rawIssues.map(sanitizeSentryCandidate);
  const incidentMode = value.incidentMode === true;
  const hasMore = value.hasMore === true;
  const requestCount =
    typeof value.requestCount === "number" ? value.requestCount : 0;
  const status = value.status === "failed" ? "failed" : "success";
  const failure =
    status === "failed" && typeof value.failure === "string" && value.failure
      ? value.failure
      : undefined;
  return {
    candidateIssueCount: issues.length,
    classificationsRequired: issues.length,
    ...(failure ? { failure } : {}),
    hasMore,
    incidentMode,
    issues,
    requestCount,
    status,
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
    const { issue, provider } = sanitizeSentryCandidate(rawIssue);
    const candidate = classifications[index];
    if (candidate === undefined)
      throw new Error("sentry_classification_missing");
    const classification = SentryClassificationSchema.parse(candidate);
    return buildSentryHealthFinding(
      issue,
      classification,
      { incidentMode: collection.incidentMode },
      provider,
    );
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
    if (result.latestEventFailures.length > 0) {
      // Collected successfully, but with thinner evidence on some issues.
      // Say so — a degraded collection that looks identical to a clean one is
      // how DEV-1424 stayed invisible.
      console.warn(
        `[health-agent] sentry latest-event enrichment skipped for ${result.latestEventFailures.length} issue(s): ${[...new Set(result.latestEventFailures)].join(", ")}`,
      );
    }
    artifact = {
      candidateIssueCount: result.candidateIssueCount,
      classificationsRequired: result.issues.length,
      hasMore: result.hasMore,
      incidentMode: result.incidentMode,
      issues: result.candidates.map(sanitizeSentryCandidate),
      ...(result.latestEventFailures.length > 0
        ? { latestEventFailures: [...new Set(result.latestEventFailures)] }
        : {}),
      requestCount: result.requestCount,
      status: "success",
      version: 1,
    };
  } catch (error) {
    // This catch used to be bare. It turned every collector failure into an
    // artifact indistinguishable from "Sentry is clean" — the workflow gates
    // classification on `issues | length`, so a thrown collector read as zero
    // issues and the run died four steps later with no trace of the cause
    // (DEV-1424). Record the reason and say so on stderr.
    const failure = internalErrorCode(error);
    console.error(`[health-agent] sentry collection failed: ${failure}`);
    artifact = {
      candidateIssueCount: 0,
      classificationsRequired: 0,
      failure,
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

/**
 * Hand back claims this run never attempted.
 *
 * `claim_health_fixes` charges an attempt at claim time, so a run that dies
 * before the repair stage spends one on nothing — and two crashes retire a
 * finding nobody ever looked at (DEV-1429). Any row still sitting in `claimed`
 * under this run's lease was never attempted: a real repair would already have
 * moved it via `transition_health_fix`. Runs from an `always()` step so a
 * crashed run still releases.
 */
export async function releaseUnattemptedClaims(
  input: { leaseOwner: string; outputPath: string },
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<JsonObject> {
  const files = filesFor(dependencies);
  let result: JsonObject;
  try {
    const released = await supabaseRequest(
      dependencies,
      "release_health_fix_claims",
      "/rest/v1/rpc/release_health_fix_claims",
      "HEALTH_AGENT_WRITER_TOKEN",
      {
        body: JSON.stringify({ p_lease_owner: input.leaseOwner }),
        method: "POST",
      },
      (candidate) => Array.isArray(candidate),
    );
    const count = (released as unknown[]).length;
    if (count > 0) {
      console.warn(
        `[health-agent] released ${count} unattempted claim(s) for ${input.leaseOwner}`,
      );
    }
    result = { leaseOwner: input.leaseOwner, released: count, version: 1 };
  } catch (error) {
    // Cleanup must never fail the run it is cleaning up after. The lease still
    // expires on its own; the cost of a miss is the attempt this would refund.
    const failure = internalErrorCode(error);
    console.error(`[health-agent] claim release failed: ${failure}`);
    result = { failure, leaseOwner: input.leaseOwner, released: 0, version: 1 };
  }
  await writeRedactedJson(input.outputPath, result, files);
  return result;
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
    // Carry the collector's own reason through rather than collapsing it into
    // a generic code here. When collection failed, the interesting failure
    // happened upstream and this step is only the messenger.
    if (issues.status !== "success") {
      throw new Error(issues.failure ?? "sentry_collection_failed");
    }
    if (classifications.status !== "success") {
      throw new Error("sentry_classification_unavailable");
    }
    if (issues.issues.length !== classifications.classifications.length) {
      throw new Error("sentry_classification_count_mismatch");
    }
    artifact = finalizeSentryArtifact(
      issues,
      classifications.classifications,
      runAt,
    );
  } catch (error) {
    const failure = internalErrorCode(error);
    console.error(`[health-agent] sentry triage failed: ${failure}`);
    artifact = failedCollectorArtifact("sentry-triage", runAt, failure);
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
  if (input.mode === "live" && isDirectoryHealthInput(evidence)) {
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

export interface CronHealthInput {
  outputPath: string;
  runAt: string;
}

function cronHttpLogRow(value: Record<string, unknown>): CronHttpLogRow {
  const {
    created,
    error_msg: errorMsg,
    job_name: jobName,
    logged_at: loggedAt,
    request_id: requestId,
    status_code: statusCode,
    timed_out: timedOut,
  } = value;
  if (
    typeof requestId !== "number" ||
    typeof jobName !== "string" ||
    (statusCode !== null && typeof statusCode !== "number") ||
    typeof timedOut !== "boolean" ||
    (errorMsg !== null && typeof errorMsg !== "string") ||
    (created !== null && typeof created !== "string") ||
    typeof loggedAt !== "string"
  ) {
    throw new Error("cron_http_log_row_invalid");
  }
  // Rebuilt field by field from the narrowed locals: a field added to
  // CronHttpLogRow later fails to compile here instead of being cast away.
  return {
    created,
    error_msg: errorMsg,
    job_name: jobName,
    logged_at: loggedAt,
    request_id: requestId,
    status_code: statusCode,
    timed_out: timedOut,
  };
}

export async function collectCronHealthArtifact(
  input: CronHealthInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<HealthCollectorArtifact> {
  const runAt = input.runAt;
  const runAtMs = Date.parse(runAt);
  // A malformed --run-at would otherwise reach toISOString() as NaN and throw a
  // bare RangeError; name it instead, so the failure reads as config, not a bug.
  if (!Number.isFinite(runAtMs)) throw new Error("cron_health_run_at_invalid");
  const cutoff = new Date(
    runAtMs - CRON_HEALTH_LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();
  try {
    const values = await supabaseRows(
      dependencies,
      "cron_http_log",
      "request_id,job_name,status_code,timed_out,error_msg,created,logged_at",
      "read_cron_http_log",
      { logged_at: `gte.${cutoff}` },
      "request_id",
    );
    // An empty read is a normal input: evaluateCronHealth reports every
    // expected job as stale. Only a failed read reaches the catch below.
    const rows = values.map(cronHttpLogRow);
    const findings = evaluateCronHealth(rows, new Date(runAtMs));
    const summary = {
      lookbackHours: CRON_HEALTH_LOOKBACK_HOURS,
      rowCount: rows.length,
    };
    const artifact: HealthCollectorArtifact = {
      collectedAt: runAt,
      evidence: summary,
      failures: [],
      findings,
      routine: "cron-health",
      skippedActions: [],
      snapshot: summary,
      status: "success",
      version: 1,
    };
    await writeRedactedJson(input.outputPath, artifact, filesFor(dependencies));
    return artifact;
  } catch (error) {
    const reason = safeRuntimeFailure(error);
    const artifact = failedCollectorArtifact(
      "cron-health",
      runAt,
      `cron_http_log_read_failed:${reason}`,
    );
    await writeRedactedJson(input.outputPath, artifact, filesFor(dependencies));
    return artifact;
  }
}

/**
 * The app half of the trail supply observation owns the database; the agent
 * half owns reporting. This collector therefore has NO Supabase reach at all —
 * it GETs one endpoint whose summary `src/lib/services/trail-supply-report.ts`
 * produces, the same division of labour the `link` collector uses. Do not add a
 * `health_agent_reader` query here: the token has no grant on the curated
 * tables, and reproducing the diff agent-side would fork the contract.
 */
const TRAIL_SUPPLY_PATH = "/api/cron/trail-supply";
const TRAIL_SUPPLY_TIMEOUT_MS = 60_000;
/**
 * Mirrors `MAX_ARTIFACT_BYTES` in `orchestrator.ts`, which is not exported. The
 * payload is bounded only by distinct (trail_slug, section_key) pairs in a
 * column with no FK and no CHECK — the very condition this detector reports —
 * so the body is measured before it is parsed, exactly as
 * `executeLinkHealthRequest` measures its own.
 */
const MAX_TRAIL_SUPPLY_RESPONSE_BYTES = 512 * 1024;

export interface TrailSupplyCollectInput {
  mode: "canary_fix" | "live" | "preflight";
  outputPath: string;
  runAt: string;
}

/**
 * Derives the endpoint from the SAME repo variable the link collector reads.
 * No new environment name exists for trail supply: a second URL variable would
 * be a second thing to rotate and a second way for the nightly run to point at
 * the wrong deployment.
 *
 * The normalization is `safeEndpoint`, shared with the link collector rather
 * than restated, so the two can never disagree about what a safe base URL is.
 * Only the failure CODE is trail-supply's own, because that code is what makes
 * a broken repo variable diagnosable in the artifact.
 */
function trailSupplyEndpoint(railwayUrl: string): string {
  let origin: string;
  try {
    // `new URL` throws its own TypeError on a malformed value, so the catch
    // covers rejection and unparseability alike.
    origin = safeEndpoint(railwayUrl);
  } catch {
    throw new Error("trail_supply_endpoint_invalid");
  }
  return `${origin}${TRAIL_SUPPLY_PATH}`;
}

/**
 * Reads the response body under a byte ceiling, then parses.
 *
 * A body that is not JSON resolves to `null` rather than throwing: `null` is a
 * schema failure the caller records honestly, and an HTML error page from an
 * intermediary is the expected shape of that case.
 */
async function trailSupplyBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (
    new TextEncoder().encode(text).byteLength > MAX_TRAIL_SUPPLY_RESPONSE_BYTES
  ) {
    throw new Error("trail_supply_response_too_large");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * A GET, because the route is a read-only report with no request body.
 *
 * The audit record is threaded on EVERY path on purpose, and the audit closure
 * and the timer are therefore created before the first possible throw. The link
 * collector shipped six nights of failures that could not be told apart because
 * its failure record never reached the audit artifact (DEV-1381). A deleted
 * `vars.FORMORIA_RAILWAY_URL` is worse than that here: repo VARIABLES are not
 * covered by the Stage 0 credential loop, so with no audit record the run
 * produced an artifact byte-identical to a dormant one and stayed green.
 *
 * Every failure code is snake_case so `internalErrorCode` can carry it verbatim
 * into the artifact. `safeErrorCode` would collapse all of them to "Error".
 */
async function requestTrailSupplyReport(
  dependencies: WorkflowRuntimeDependencies,
): Promise<unknown> {
  const audit = auditFor(dependencies);
  const startedAt = performance.now();
  const request = { method: "GET", resource: TRAIL_SUPPLY_PATH };
  const failed = (code: string, response: Record<string, JsonValue>): Error => {
    audit({
      adapter: "trail-supply",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      operation: "read_trail_supply_report",
      request,
      response,
      schemaValid: false,
      status: "failure",
    });
    return new Error(code);
  };

  const environment = environmentFor(dependencies);
  const railwayUrl = optionalEnvironment(environment, "FORMORIA_RAILWAY_URL");
  if (!railwayUrl) {
    throw failed("trail_supply_endpoint_missing", {
      error: "endpoint_missing",
    });
  }
  let url: string;
  try {
    url = trailSupplyEndpoint(railwayUrl);
  } catch {
    throw failed("trail_supply_endpoint_invalid", {
      error: "endpoint_invalid",
    });
  }
  // An absent secret used to omit the header, so the route answered 401 and the
  // artifact reported `skipped` — which the Stage 3 merge accepts as success.
  // Stage 0 does gate this secret, but the Stage 0 loop is skipped entirely in
  // preflight mode. Name the failure instead of sending an unauthenticated
  // request that is guaranteed to be rejected.
  const originSecret = optionalEnvironment(environment, "ORIGIN_SECRET");
  if (!originSecret) {
    throw failed("trail_supply_origin_secret_missing", {
      error: "origin_secret_missing",
    });
  }

  let response: Response;
  try {
    response = await fetchFor(dependencies)(url, {
      headers: {
        Accept: "application/json",
        "x-origin-verify": originSecret,
      },
      method: "GET",
      signal: signal(TRAIL_SUPPLY_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout and an unreachable host are different operational problems: one
    // is the route getting slower, the other is the deployment being gone.
    throw failed(
      error instanceof Error && error.name === "TimeoutError"
        ? "trail_supply_request_timeout"
        : "trail_supply_request_unreachable",
      { error: "request_failed" },
    );
  }

  let body: unknown;
  try {
    body = await trailSupplyBody(response);
  } catch (error) {
    throw failed(
      error instanceof Error &&
        error.message === "trail_supply_response_too_large"
        ? "trail_supply_response_too_large"
        : "trail_supply_body_unreadable",
      { httpStatus: response.status },
    );
  }

  // Validity is derived from the BODY, never from `response.ok`. An
  // intermediary answering 200 with an HTML error page would otherwise be
  // recorded as `status: "success", schemaValid: true` while the artifact was
  // written `skipped` — and after the merge carries the counts, this audit
  // record is the most precise signal in the uploaded run.
  const schemaValid = response.ok && isTrailSupplyReport(body);
  audit({
    adapter: "trail-supply",
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    operation: "read_trail_supply_report",
    request,
    response: { httpStatus: response.status },
    schemaValid,
    status: schemaValid ? "success" : "failure",
  });
  // The status rides the code, so a rotated secret (401), a gateway outage
  // (502) and a route bug (500) are three different strings in the artifact,
  // the merged `failures[]` and the Slack digest.
  if (!response.ok) {
    throw new Error(`trail_supply_request_status_${response.status}`);
  }
  // A 200 with a body that does not match the contract falls through to
  // `parseTrailSupplyReport` in the caller, which names the exact field.
  return body;
}

/**
 * Collects the nightly trail supply observation.
 *
 * An unreachable endpoint, a non-2xx, or a payload that does not match the
 * summary contract all degrade to `skipped` with the reason recorded in
 * `failures[]`. It must never throw and it must never write `failed`: the step
 * runs on a schedule against environments where the report is legitimately
 * dormant, and a thrown command or a nightly red would be alarm fatigue by
 * construction. `continue-on-error` in the workflow is the belt; this is the
 * braces.
 */
export async function collectTrailSupplyArtifact(
  input: TrailSupplyCollectInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<TrailSupplyArtifact> {
  const files = filesFor(dependencies);
  try {
    const artifact = trailSupplyArtifact({
      collectedAt: input.runAt,
      mode: input.mode,
      // The route is a read-only GET with nothing to rehearse away, so
      // preflight reads it too; only the mode label differs.
      report: parseTrailSupplyReport(
        await requestTrailSupplyReport(dependencies),
      ),
    });
    // Inside the try, like `collectCronHealthArtifact`. The write is the last
    // thing that can throw here — `writeRedactedJson` rejects past
    // MAX_RESULT_BYTES — and a throw would skip `main()`'s `writeAuditArtifact`
    // as well, losing the audit file that is this collector's only remaining
    // distinguishing signal.
    await writeRedactedJson(input.outputPath, artifact, files);
    return artifact;
  } catch (error) {
    const artifact = trailSupplyArtifact({
      collectedAt: input.runAt,
      // `internalErrorCode`, not `safeErrorCode`: the latter returns
      // `error.name`, which is "Error" for every code this path throws, so a
      // deleted repo variable, a 401, a timeout and nine parse-drift codes all
      // arrived as one undiagnosable string. The allow-list is a bare
      // snake_case token, so no URL or credential can reach the artifact.
      failures: [`${internalErrorCode(error)}:trail_supply_collection_failed`],
      mode: input.mode,
      report: UNOBSERVED_TRAIL_SUPPLY,
    });
    // Ceiling: a filesystem error on THIS write still escapes, exactly as it
    // does for the sibling collector. The artifact is a fixed-size dormant
    // record, so the size limit cannot be what fails here.
    await writeRedactedJson(input.outputPath, artifact, files);
    return artifact;
  }
}

export async function runAggregateAndDeliver(
  input: AggregateWorkflowInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<AggregateResult> {
  const result = await aggregateAndDeliver(
    {
      artifactPaths: {
        "cron-health": input.cronArtifactPath,
        "directory-health": input.directoryArtifactPath,
        "link-checker": input.linkArtifactPath,
        "quality-health": input.qualityArtifactPath,
        "sentry-triage": input.sentryArtifactPath,
      },
      brandReviewArtifactPath: input.brandReviewArtifactPath,
      deliver: input.deferDelivery !== true,
      exhaustedAutomationFingerprints: input.exhaustedAutomationFingerprints,
      mode: input.mode,
      prOutcomes: input.prOutcomes,
      runAt: input.runAt,
      workflowAttempt: input.workflowAttempt,
      workflowRunId: input.workflowRunId,
      workflowUrl: input.workflowUrl,
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
  if (
    result.deliveryErrors.agentHub.length > 0 ||
    result.deliveryErrors.slack.length > 0
  ) {
    throw new Error("health_delivery_failed");
  }
  return result;
}

const EMPTY_SEVERITIES = {
  critical: 0,
  high: 0,
  low: 0,
  medium: 0,
};

async function optionalArtifact(
  path: string | undefined,
  dependencies: WorkflowRuntimeDependencies,
): Promise<unknown> {
  if (!path) return undefined;
  try {
    return await readBoundedJson(path, filesFor(dependencies));
  } catch {
    return undefined;
  }
}

function terminalCheck(
  aggregate: unknown,
  routine: HealthRoutine,
): HealthSummary["checks"]["link"] {
  const artifacts = isRecord(aggregate) ? aggregate.artifacts : undefined;
  const value = isRecord(artifacts) ? artifacts[routine] : undefined;
  if (!isRecord(value)) {
    return {
      findingCount: 0,
      severities: { ...EMPTY_SEVERITIES },
      status: "failed",
    };
  }
  const artifact = validateCollectorArtifact(value);
  const severities = { ...EMPTY_SEVERITIES };
  for (const finding of artifact.findings) severities[finding.severity] += 1;
  return {
    findingCount: artifact.findings.length,
    severities,
    status:
      artifact.status === "failed"
        ? "failed"
        : artifact.status === "skipped"
          ? "skipped"
          : "success",
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function queueBatchFindingCount(
  queue: unknown,
  policy: "automatic" | "human",
): number {
  if (!isRecord(queue) || !isRecord(queue[policy])) return 0;
  const findings = queue[policy].findings;
  return Array.isArray(findings) ? findings.length : 0;
}

function queueBatchFingerprints(
  queue: unknown,
  policy: "automatic" | "human",
): string[] {
  if (!isRecord(queue) || !isRecord(queue[policy])) return [];
  const findings = queue[policy].findings;
  if (!Array.isArray(findings)) return [];
  return findings.flatMap((finding) =>
    isRecord(finding) && typeof finding.fingerprint === "string"
      ? [finding.fingerprint]
      : [],
  );
}

function queueLifecycle(queue: unknown): HealthFindingLifecycle {
  const lifecycle =
    isRecord(queue) && isRecord(queue.lifecycle) ? queue.lifecycle : {};
  const count = (value: unknown): number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : 0;
  return {
    new: count(lifecycle.new),
    ongoing: count(lifecycle.ongoing),
    regressed: count(lifecycle.regressed),
  };
}

function queueVerifiedFixedCount(queue: unknown): number {
  return isRecord(queue)
    ? stringArray(queue.verifiedFixedFingerprints).length
    : 0;
}

function queueFailedVerificationFingerprints(queue: unknown): string[] {
  return isRecord(queue)
    ? stringArray(queue.failedVerificationFingerprints)
    : [];
}

function linearSyncFunction(
  dependencies: WorkflowRuntimeDependencies,
): ((input: LinearSyncInput) => Promise<LinearSyncResult>) | undefined {
  const linear = dependencies.linear;
  if (!linear) return undefined;
  return typeof linear === "function" ? linear : (input) => linear.sync(input);
}

function ticketLedger(dependencies: WorkflowRuntimeDependencies): {
  listUnticketed?: (
    fingerprints: readonly string[],
  ) => Promise<readonly string[]>;
  reserve?: (
    fingerprints: readonly string[],
    reservationIdentifier: string,
  ) => Promise<unknown>;
  finalize?: (
    fingerprints: readonly string[],
    reservationIdentifier: string,
    linearIdentifier: string,
  ) => Promise<unknown>;
  release?: (
    fingerprints: readonly string[],
    reservationIdentifier: string,
  ) => Promise<unknown>;
  markTicketed?: (
    fingerprints: readonly string[],
    linearIdentifier: string,
  ) => Promise<unknown>;
} {
  const database = dependencies.database;
  const queue = dependencies.queue;
  const listUnticketed =
    database?.listUnticketedFingerprints ?? queue?.listUnticketedFingerprints;
  const markTicketed =
    database?.markFingerprintsTicketed ?? queue?.markFingerprintsTicketed;
  const reserve =
    database?.reserveTicketCandidates ?? queue?.reserveTicketCandidates;
  const finalize =
    database?.finalizeTicketReservation ?? queue?.finalizeTicketReservation;
  const release =
    database?.releaseTicketReservation ?? queue?.releaseTicketReservation;
  return {
    ...(listUnticketed ? { listUnticketed } : {}),
    ...(reserve ? { reserve } : {}),
    ...(finalize ? { finalize } : {}),
    ...(release ? { release } : {}),
    ...(markTicketed ? { markTicketed } : {}),
  };
}

function linearOutcomeIdentifier(
  outcomes: readonly JsonValue[],
): string | undefined {
  for (const outcome of outcomes) {
    if (!isRecord(outcome)) continue;
    const identifier =
      typeof outcome.identifier === "string" ? outcome.identifier.trim() : "";
    if (/^[A-Z]+-\d+$/.test(identifier)) return identifier;
  }
  return undefined;
}

function repairResult(
  value: unknown,
  policy: "automatic" | "human",
  findingCount: number,
  phases: FinalReportInput["phases"],
): {
  batch: JsonObject;
  pr?: number;
} {
  const fallbackStatus =
    findingCount === 0
      ? "not_required"
      : phases.repair === "failed" || phases.publish === "failed"
        ? "failed"
        : policy === "human"
          ? "needs_human"
          : "not_published";
  if (!isRecord(value)) {
    return {
      batch: {
        finding_count: findingCount,
        merge_policy: policy,
        status: fallbackStatus,
      },
    };
  }
  const pr =
    typeof value.pr_number === "number" &&
    Number.isSafeInteger(value.pr_number) &&
    value.pr_number > 0
      ? value.pr_number
      : undefined;
  const status =
    typeof value.status === "string" && value.status.trim()
      ? value.status.trim().slice(0, 80)
      : fallbackStatus;
  return {
    batch: {
      finding_count: findingCount,
      merge_policy: policy,
      ...(pr
        ? {
            pr_number: pr,
            pr_url: `https://github.com/ytchou/Formoria/pull/${pr}`,
          }
        : {}),
      status,
    },
    ...(pr ? { pr } : {}),
  };
}

function aggregateFailures(value: unknown): string[] {
  return isRecord(value) ? stringArray(value.failures) : ["aggregate_missing"];
}

function terminalFindings(value: unknown): readonly HealthFinding[] {
  if (!isRecord(value)) return [];
  try {
    return findingsFromArtifact(value);
  } catch {
    return [];
  }
}

export async function deliverFinalHealthReport(
  input: FinalReportInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<JsonObject> {
  const aggregate = await optionalArtifact(
    input.aggregateArtifactPath,
    dependencies,
  );
  const queue = await optionalArtifact(input.queueArtifactPath, dependencies);
  const findings = terminalFindings(aggregate);
  const [automaticPr, humanPr] = await Promise.all([
    optionalArtifact(input.automaticPrResultPath, dependencies),
    optionalArtifact(input.humanPrResultPath, dependencies),
  ]);
  const checks: HealthSummary["checks"] = {
    directory: terminalCheck(aggregate, "directory-health"),
    link: terminalCheck(aggregate, "link-checker"),
    quality: terminalCheck(aggregate, "quality-health"),
    sentry: terminalCheck(aggregate, "sentry-triage"),
    cron: terminalCheck(aggregate, "cron-health"),
  };
  const findingCount = Object.values(checks).reduce(
    (total, check) => total + check.findingCount,
    0,
  );
  const severities = { ...EMPTY_SEVERITIES };
  for (const check of Object.values(checks)) {
    severities.critical += check.severities.critical;
    severities.high += check.severities.high;
    severities.low += check.severities.low;
    severities.medium += check.severities.medium;
  }
  const automatic = repairResult(
    automaticPr,
    "automatic",
    queueBatchFindingCount(queue, "automatic"),
    input.phases,
  );
  const human = repairResult(
    humanPr,
    "human",
    queueBatchFindingCount(queue, "human"),
    input.phases,
  );
  const prResults = [automatic, human];
  const pullRequests = prResults.filter(
    (result) => result.pr !== undefined,
  ).length;
  const repairedThisRun = prResults.reduce(
    (total, result) =>
      total +
      (result.pr && typeof result.batch.finding_count === "number"
        ? result.batch.finding_count
        : 0),
    0,
  );
  const detectorFailures = aggregateFailures(aggregate);
  const queueFailures = isRecord(queue) ? stringArray(queue.failures) : [];
  const failures = [...detectorFailures, ...queueFailures];
  const deliveryWarnings: HealthDeliveryWarning[] = [];
  const lifecycle = queueLifecycle(queue);
  const verifiedFixed = queueVerifiedFixedCount(queue);
  const exhaustedAutomationFingerprints = automatic.pr
    ? queueFailedVerificationFingerprints(queue)
    : [
        ...queueBatchFingerprints(queue, "automatic"),
        ...queueFailedVerificationFingerprints(queue),
      ];
  const reviewFingerprints = new Set([
    ...findings
      .filter(requiresHumanPolicy)
      .map(({ fingerprint }) => fingerprint),
    ...exhaustedAutomationFingerprints,
  ]);
  const reviewFindingCount = reviewFingerprints.size;
  const pullRequestUrls = prResults.flatMap((result) =>
    typeof result.batch.pr_url === "string" ? [result.batch.pr_url] : [],
  );
  // A detector that fails degrades the run; it does not fail it. The other
  // detectors' findings are still valid, still queued and still repairable —
  // and failing the whole run over one collector is exactly what stranded 147
  // findings for four nights while Sentry was broken (DEV-1424). A degraded run
  // reports `needs_attention` and still proceeds to repair and publish.
  //
  // Three things remain genuine run failures:
  //   - a pipeline phase failed (the machinery itself broke),
  //   - the queue failed (findings could not be persisted or reconciled),
  //   - every detector failed at once, which means the run produced no signal
  //     and "degraded" would be a lie.
  const checkValues = Object.values(checks);
  const failedCheckCount = checkValues.filter(
    (check) => check.status === "failed",
  ).length;
  const hasOperationalFailure = () =>
    queueFailures.length > 0 ||
    Object.values(input.phases).includes("failed") ||
    (checkValues.length > 0 && failedCheckCount === checkValues.length);
  const linearOutcomes: JsonValue[] = [];
  const linear = linearSyncFunction(dependencies);
  if (input.mode === "live" && linear) {
    // Sole Linear writer. Only findings that have never been ticketed reach
    // the adapter, and the adapter always creates a fresh digest ticket.
    const ledger = ticketLedger(dependencies);
    const reviewFindings = findings.filter(({ fingerprint }) =>
      reviewFingerprints.has(fingerprint),
    );
    let ticketFindings = reviewFindings;
    if (ledger.listUnticketed && reviewFindings.length > 0) {
      try {
        const unticketed = new Set(
          await ledger.listUnticketed(
            reviewFindings.map(({ fingerprint }) => fingerprint),
          ),
        );
        ticketFindings = reviewFindings.filter(({ fingerprint }) =>
          unticketed.has(fingerprint),
        );
      } catch (error) {
        ticketFindings = [];
        deliveryWarnings.push(
          optionalDeliveryWarning(
            "linear_ticket_candidates_failed",
            "list_unticketed_health_fingerprints",
            error,
          ),
        );
      }
    }
    const reservationReady = Boolean(ledger.reserve && ledger.finalize);
    const ticketFingerprints = () =>
      ticketFindings.map(({ fingerprint }) => fingerprint);
    const reservationIdentifier = `health-agent-reservation:${input.workflowRunId}:${input.workflowAttempt}`;
    let reservationHeld = false;
    const releaseReservation = async (): Promise<void> => {
      if (!reservationHeld) return;
      if (!ledger.release) {
        deliveryWarnings.push({
          category: "optional_delivery",
          code: "linear_ticket_reservation_release_unavailable",
          operation: "release_health_fingerprint_ticket_reservation",
          reason: "reservation_release_unavailable",
        });
        return;
      }
      try {
        await ledger.release(ticketFingerprints(), reservationIdentifier);
        reservationHeld = false;
      } catch (error) {
        deliveryWarnings.push(
          optionalDeliveryWarning(
            "linear_ticket_reservation_release_failed",
            "release_health_fingerprint_ticket_reservation",
            error,
          ),
        );
      }
    };
    if (ticketFindings.length > 0 && !reservationReady) {
      ticketFindings = [];
      deliveryWarnings.push({
        category: "optional_delivery",
        code: "linear_ticket_reservation_unavailable",
        operation: "reserve_health_fingerprint_tickets",
        reason: "linear_ticket_reservation_unavailable",
      });
    }
    if (ticketFindings.length > 0 && ledger.reserve && ledger.finalize) {
      reservationHeld = true;
      try {
        await ledger.reserve(ticketFingerprints(), reservationIdentifier);
      } catch (error) {
        deliveryWarnings.push(
          optionalDeliveryWarning(
            "linear_ticket_reservation_failed",
            "reserve_health_fingerprint_tickets",
            error,
          ),
        );
        await releaseReservation();
        ticketFindings = [];
      }
    }
    if (ticketFindings.length > 0) {
      try {
        const sync = await linear({
          exhaustedAutomationFingerprints,
          findings: ticketFindings,
          summary: {
            fixed: verifiedFixed,
            newFindings: lifecycle.new,
            ongoingFindings: lifecycle.ongoing,
            pullRequestUrls,
            regressedFindings: lifecycle.regressed,
            reviewFindings: reviewFindingCount,
            runAt: input.runAt,
            status: hasOperationalFailure()
              ? "failed"
              : findingCount > 0
                ? "needs_attention"
                : "resolved",
            totalFindings: findingCount,
            unresolved: findingCount,
            workflowUrl: input.workflowUrl,
          },
        });
        linearOutcomes.push(...(sync.outcomes ?? []));
        const identifier = linearOutcomeIdentifier(sync.outcomes ?? []);
        if (!identifier) {
          deliveryWarnings.push({
            category: "optional_delivery",
            code: "linear_ticket_identifier_missing",
            operation: "linear_sync",
            reason: "linear_identifier_missing",
          });
        } else if (reservationHeld && ledger.finalize) {
          try {
            await ledger.finalize(
              ticketFingerprints(),
              reservationIdentifier,
              identifier,
            );
            reservationHeld = false;
          } catch (error) {
            deliveryWarnings.push(
              optionalDeliveryWarning(
                "linear_ticket_ledger_failed",
                "finalize_health_fingerprint_tickets",
                error,
              ),
            );
          }
        } else if (ledger.markTicketed) {
          try {
            await ledger.markTicketed(ticketFingerprints(), identifier);
          } catch (error) {
            deliveryWarnings.push(
              optionalDeliveryWarning(
                "linear_ticket_ledger_failed",
                "mark_health_fingerprints_ticketed",
                error,
              ),
            );
          }
        }
      } catch (error) {
        deliveryWarnings.push(
          optionalDeliveryWarning(
            "linear_final_sync_failed",
            "linear_sync",
            error,
          ),
        );
      }
    }
  }
  const operationalFailure = hasOperationalFailure();
  const overallStatus: HealthSummary["overallStatus"] = operationalFailure
    ? "failed"
    : findingCount > 0
      ? "needs_attention"
      : "healthy";
  const repair = {
    batches: {
      automatic: {
        findingCount: queueBatchFindingCount(queue, "automatic"),
        ...(typeof automatic.batch.pr_number === "number"
          ? { prNumber: automatic.batch.pr_number }
          : {}),
        ...(typeof automatic.batch.pr_url === "string"
          ? { prUrl: automatic.batch.pr_url }
          : {}),
        status: String(automatic.batch.status),
      },
      human: {
        findingCount: queueBatchFindingCount(queue, "human"),
        ...(typeof human.batch.pr_number === "number"
          ? { prNumber: human.batch.pr_number }
          : {}),
        ...(typeof human.batch.pr_url === "string"
          ? { prUrl: human.batch.pr_url }
          : {}),
        status: String(human.batch.status),
      },
    },
    claimed: isRecord(queue)
      ? stringArray(queue.claimedFingerprints).length
      : 0,
    fixed: verifiedFixed,
    pullRequests,
    queued: isRecord(queue)
      ? stringArray(queue.enqueuedFingerprints).length
      : 0,
    repaired: repairedThisRun,
    unresolved: Math.max(0, findingCount - repairedThisRun),
  };
  const healthSummary: HealthSummary = {
    checks,
    ...(deliveryWarnings.length > 0 ? { deliveryWarnings } : {}),
    lifecycle,
    overallStatus,
    phases: input.phases,
    repair,
    ...terminalLinearTicket(aggregate, linearOutcomes, findingCount > 0),
  };
  const queued = repair.queued;
  const claimed = repair.claimed;
  const deliveryWarningValues: JsonValue[] = deliveryWarnings.map((warning) =>
    redactForAudit(warning),
  );
  const envelope: HealthAgentEnvelope = {
    data: {
      checks: {
        directory: {
          finding_count: checks.directory.findingCount,
          urgency: {
            follow_up:
              checks.directory.severities.medium +
              checks.directory.severities.low,
            urgent:
              checks.directory.severities.critical +
              checks.directory.severities.high,
          },
          severities: checks.directory.severities,
          status: checks.directory.status,
        },
        link: {
          finding_count: checks.link.findingCount,
          urgency: {
            follow_up:
              checks.link.severities.medium + checks.link.severities.low,
            urgent:
              checks.link.severities.critical + checks.link.severities.high,
          },
          severities: checks.link.severities,
          status: checks.link.status,
        },
        quality: {
          finding_count: checks.quality.findingCount,
          urgency: {
            follow_up:
              checks.quality.severities.medium + checks.quality.severities.low,
            urgent:
              checks.quality.severities.critical +
              checks.quality.severities.high,
          },
          severities: checks.quality.severities,
          status: checks.quality.status,
        },
        sentry: {
          finding_count: checks.sentry.findingCount,
          urgency: {
            follow_up:
              checks.sentry.severities.medium + checks.sentry.severities.low,
            urgent:
              checks.sentry.severities.critical + checks.sentry.severities.high,
          },
          severities: checks.sentry.severities,
          status: checks.sentry.status,
        },
        cron: {
          finding_count: checks.cron.findingCount,
          urgency: {
            follow_up:
              checks.cron.severities.medium + checks.cron.severities.low,
            urgent:
              checks.cron.severities.critical + checks.cron.severities.high,
          },
          severities: checks.cron.severities,
          status: checks.cron.status,
        },
      },
      detector_failures: failures,
      delivery_warnings: deliveryWarningValues,
      failures,
      infrastructure_failures: [],
      lifecycle: {
        new: lifecycle.new,
        ongoing: lifecycle.ongoing,
        regressed: lifecycle.regressed,
      },
      linear_outcomes: linearOutcomes,
      notification_owner: "github_actions",
      overall_status: overallStatus,
      phases: input.phases,
      repair: {
        batches: { automatic: automatic.batch, human: human.batch },
        claimed,
        fixed: repair.fixed,
        pull_requests: repair.pullRequests,
        queued,
        repaired_this_run: repairedThisRun,
        unresolved: repair.unresolved,
      },
      totals: { finding_count: findingCount, severities },
      ...(input.workflowUrl ? { workflow_url: input.workflowUrl } : {}),
    },
    date: taipeiDate(input.runAt),
    project: "formoria",
    routine: "health-agent",
    run_at: input.runAt,
    source: "github_actions",
    source_run_id: `github-actions:health-agent:${input.workflowRunId}:${input.workflowAttempt}`,
    status: operationalFailure ? "failed" : "success",
    tickets_created: healthSummary.ticket
      ? [healthSummary.ticket.identifier]
      : [],
    verdict_severity: operationalFailure
      ? "error"
      : severities.critical > 0
        ? "critical"
        : severities.high > 0
          ? "error"
          : findingCount > 0
            ? "warning"
            : "ok",
    verdict_text: managerVerdict(healthSummary),
    version: 1,
  };
  if (!input.deferDelivery && !dependencies.delivery)
    throw new Error("final_report_delivery_unavailable");
  const [agentHub, slack] = input.deferDelivery
    ? ([{ status: "fulfilled" }, { status: "fulfilled" }] as const)
    : await Promise.allSettled([
        dependencies.delivery!.agentHub(envelope),
        dependencies.delivery!.slack({
          healthSummary,
          workflowUrl: input.workflowUrl,
        }),
      ]);
  const infrastructureFailures: HealthInfrastructureFailure[] = [
    ...(agentHub.status === "rejected"
      ? [
          {
            category: "infrastructure" as const,
            code: "agent_hub_delivery_failed",
            operation: "deliver_envelope",
            reason: safeRuntimeFailure(agentHub.reason),
          },
        ]
      : []),
    ...(slack.status === "rejected"
      ? [
          {
            category: "infrastructure" as const,
            code: "slack_delivery_failed",
            operation: "deliver_digest",
            reason: safeRuntimeFailure(slack.reason),
          },
        ]
      : []),
  ];
  const result: JsonObject = {
    agent_hub: agentHub.status,
    delivery_warnings: deliveryWarningValues,
    envelope: envelope as unknown as JsonValue,
    infrastructure_failures: infrastructureFailures.map((failure) =>
      redactForAudit(failure),
    ),
    slack: slack.status,
    terminal: true,
    version: 1,
  };
  await writeRedactedJson(input.outputPath, result, filesFor(dependencies));
  if (agentHub.status === "rejected" || slack.status === "rejected") {
    throw new Error("final_report_delivery_failed");
  }
  return result;
}

function terminalLinearTicket(
  aggregate: unknown,
  finalOutcomes: readonly JsonValue[] = [],
  active = true,
): Pick<HealthSummary, "ticket"> {
  if (!active) return {};
  const aggregateOutcomes =
    isRecord(aggregate) && Array.isArray(aggregate.linearOutcomes)
      ? aggregate.linearOutcomes
      : [];
  const outcome = [...finalOutcomes, ...aggregateOutcomes].find(
    (value) => isRecord(value) && typeof value.identifier === "string",
  );
  if (!isRecord(outcome) || typeof outcome.identifier !== "string") return {};
  const identifier = outcome.identifier.trim();
  if (!/^[A-Z]+-\d+$/.test(identifier)) return {};
  return {
    ticket: {
      identifier,
      url: `https://linear.app/ytchou/issue/${identifier}`,
    },
  };
}

function managerVerdict(summary: HealthSummary): string {
  const total = Object.values(summary.checks).reduce(
    (count, check) => count + check.findingCount,
    0,
  );
  const work =
    summary.repair.pullRequests === 0
      ? "No repair PR created."
      : `${summary.repair.pullRequests} repair PR${summary.repair.pullRequests === 1 ? "" : "s"} created.`;
  const action = summary.ticket
    ? `Review ${summary.ticket.identifier}: ${summary.ticket.url}`
    : summary.overallStatus === "failed"
      ? "Review the failed workflow."
      : summary.repair.pullRequests > 0
        ? "Review the repair PR."
        : summary.overallStatus === "healthy"
          ? "No manager action needed."
          : "Review unresolved findings.";
  return `${total} issues; ${summary.repair.repaired ?? 0} repaired this run. ${work} ${action}`;
}

function isStaleBranchFinding(finding: HealthFinding): boolean {
  return (
    finding.source === "directory" &&
    finding.fingerprint.startsWith("directory:stale-branch:")
  );
}

function staleBranchFindingsFromAggregate(value: unknown): HealthFinding[] {
  if (!isRecord(value) || !isRecord(value.artifacts)) {
    throw new Error("stale_branch_cleanup_aggregate_invalid");
  }
  const directoryArtifact = value.artifacts["directory-health"];
  if (!isRecord(directoryArtifact)) {
    throw new Error("stale_branch_cleanup_directory_artifact_missing");
  }
  return validateCollectorArtifact(directoryArtifact).findings.filter(
    (finding) =>
      isStaleBranchFinding(finding) &&
      finding.mergePolicy === "automatic" &&
      finding.severity === "low",
  );
}

function staleBranchCleanupEvidence(finding: HealthFinding): {
  branch: string;
  recordedTipSha: string;
} {
  const branch =
    typeof finding.evidence.branchRef === "string"
      ? finding.evidence.branchRef.trim()
      : "";
  const recordedTipSha =
    typeof finding.evidence.currentRemoteTipSha === "string"
      ? finding.evidence.currentRemoteTipSha.trim()
      : "";
  const branchMalformed =
    !branch ||
    branch.length > 255 ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("//") ||
    /[\u0000-\u0020\u007f~^:?*[\]\\]/.test(branch);
  if (branchMalformed || !/^[0-9a-f]{40}$/i.test(recordedTipSha)) {
    throw new Error("stale_branch_cleanup_evidence_invalid");
  }
  if (
    finding.fingerprint !==
    `directory:stale-branch:${recordedTipSha.toLowerCase()}`
  ) {
    throw new Error("stale_branch_cleanup_fingerprint_mismatch");
  }
  return { branch, recordedTipSha };
}

function githubRepository(dependencies: WorkflowRuntimeDependencies): {
  owner: string;
  repo: string;
} {
  const repository = requiredEnvironment(
    environmentFor(dependencies),
    "GITHUB_REPOSITORY",
  );
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) throw new Error("github_repository_invalid");
  return { owner, repo };
}

export async function cleanupStaleBranches(
  input: StaleBranchCleanupInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<StaleBranchCleanupResult> {
  const value = await readBoundedJson(
    input.aggregateArtifactPath,
    filesFor(dependencies),
  );
  const requestedCanary = new Set(input.canaryFingerprints ?? []);
  const candidates = staleBranchFindingsFromAggregate(value)
    .filter(
      (finding) =>
        input.mode !== "canary_fix" || requestedCanary.has(finding.fingerprint),
    )
    .map((finding) => ({
      ...staleBranchCleanupEvidence(finding),
      fingerprint: finding.fingerprint,
    }));

  let outcomes: StaleBranchCleanupOutcome[];
  if (input.mode === "preflight") {
    outcomes = candidates.map((candidate) => ({
      ...candidate,
      outcome: "skipped",
      reason: "preflight",
    }));
  } else {
    const environment = environmentFor(dependencies);
    const repository = githubRepository(dependencies);
    const github = createGitHubAdapter({
      ...repository,
      appToken: requiredEnvironment(environment, "GITHUB_APP_TOKEN"),
      audit: auditFor(dependencies),
      fetchImpl: fetchFor(dependencies),
    });
    outcomes = await Promise.all(
      candidates.map(async (candidate) => {
        const result = await github.deleteBranchIfSafe(
          candidate.branch,
          candidate.recordedTipSha,
        );
        return {
          branch: candidate.branch,
          ...(result.outcome === "deleted" && result.tipSha
            ? { deletedTipSha: result.tipSha }
            : {}),
          fingerprint: candidate.fingerprint,
          outcome: result.outcome,
          ...(result.reason ? { reason: result.reason } : {}),
          recordedTipSha: candidate.recordedTipSha,
        };
      }),
    );
  }

  const result: StaleBranchCleanupResult = {
    mode: input.mode,
    outcomes,
    runIdentity: input.runIdentity,
    version: 1,
  };
  if (outcomes.length > 0 && dependencies.delivery) {
    const allDeleted = outcomes.every(({ outcome }) => outcome === "deleted");
    const envelope = buildPrResultEnvelope({
      mergePolicy: "automatic",
      mode: input.mode,
      result: {
        autoMergeEnabled: false,
        findings: outcomes.map((outcome) => ({
          fingerprint: outcome.fingerprint,
          source: "directory",
          status: outcome.outcome,
        })),
        fixed: allDeleted,
        mergePolicy: "automatic",
        merged: false,
        snapshotId: input.runIdentity,
        status: allDeleted ? "fixed" : "skipped",
      },
      runAt: input.runAt,
      snapshotId: input.runIdentity,
      status: allDeleted ? "opened" : "failed",
      workflowAttempt: input.workflowAttempt,
      workflowRunId: `${input.workflowRunId}-cleanup`,
    });
    const report: SlackDigestInput = {
      actionableFindings: [],
      failures: [],
      linearOutcomes: [],
      prOutcomes: outcomes.map((outcome) => ({
        action: "stale_branch_cleanup",
        branch: outcome.branch,
        fingerprint: outcome.fingerprint,
        outcome: outcome.outcome,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
        tip_sha: outcome.deletedTipSha ?? outcome.recordedTipSha,
      })),
      skippedActions: outcomes
        .filter(({ outcome }) => outcome === "skipped")
        .map((outcome) => ({
          action: "stale_branch_cleanup",
          fingerprint: outcome.fingerprint,
          reason: outcome.reason ?? "safety_revalidation",
        })),
    };
    const [agentHub, slack] = await Promise.allSettled([
      dependencies.delivery.agentHub(envelope),
      dependencies.delivery.slack(report),
    ]);
    result.delivery = { agentHub: agentHub.status, slack: slack.status };
    if (agentHub.status === "rejected" || slack.status === "rejected") {
      await writeRedactedJson(input.outputPath, result, filesFor(dependencies));
      throw new Error("stale_branch_cleanup_delivery_failed");
    }
  }
  await writeRedactedJson(input.outputPath, result, filesFor(dependencies));
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

function completedDetectorSources(value: unknown): HealthSource[] {
  if (!isRecord(value) || !isRecord(value.artifacts)) return [];
  const artifacts = value.artifacts;
  const routines = [
    ["cron-health", "cron"],
    ["directory-health", "directory"],
    ["link-checker", "link"],
    ["quality-health", "quality"],
    ["sentry-triage", "sentry"],
  ] as const;
  return routines.flatMap(([routine, source]) => {
    const artifact = artifacts[routine];
    if (!isRecord(artifact)) return [];
    try {
      if (validateCollectorArtifact(artifact).status !== "success") {
        return [];
      }
      if (routine !== "sentry-triage") return [source];
      const snapshot = isRecord(artifact.snapshot) ? artifact.snapshot : {};
      return snapshot.hasMore === false && snapshot.incidentMode === false
        ? [source]
        : [];
    } catch {
      return [];
    }
  });
}

export async function enqueueAndClaimWorkflowBatch(
  input: QueueWorkflowInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<QueueBatchResult> {
  const value = await readBoundedJson(
    input.findingsArtifactPath,
    filesFor(dependencies),
  );
  const findings = findingsFromArtifact(value).filter(
    (finding) => !isStaleBranchFinding(finding),
  );
  const result = await enqueueAndClaimPolicyBatches(
    {
      canaryFingerprints: input.canaryFingerprints,
      findings,
      leaseOwner: input.leaseOwner,
      mode: input.mode,
      completedSources:
        input.mode === "live" ? completedDetectorSources(value) : [],
    },
    {
      ...dependencies,
      queue: dependencies.queue ?? supabaseQueueDependencies(dependencies),
    },
    environmentFor(dependencies),
  );
  if (result.verifiedSentryAbsences.length > 0) {
    try {
      await resolveSentryIssues(
        result.verifiedSentryAbsences.map(({ issueId }) => issueId),
        {
          audit: auditFor(dependencies),
          baseUrl: requiredEnvironment(
            environmentFor(dependencies),
            "SENTRY_BASE_URL",
          ),
          resolveToken: requiredEnvironment(
            environmentFor(dependencies),
            "SENTRY_READ_TOKEN",
          ),
          fetchImplementation: fetchFor(dependencies),
        },
      );
      for (const absence of result.verifiedSentryAbsences) {
        await transitionVerifiedSentryAbsence(
          absence.id,
          absence.status,
          dependencies,
        );
        result.verifiedFixedFingerprints.push(absence.fingerprint);
        result.verifiedFixedSentryIssueIds.push(absence.issueId);
      }
    } catch {
      result.failures.push("sentry_post_verification_resolution:failed");
    }
  }
  await writeRedactedJson(input.outputPath, result, filesFor(dependencies));
  return result;
}

async function transitionVerifiedSentryAbsence(
  id: string,
  expectedStatus: string,
  dependencies: WorkflowRuntimeDependencies,
): Promise<void> {
  await supabaseRequest(
    dependencies,
    "transition_verified_sentry_fix",
    "/rest/v1/rpc/verify_health_fix_absence",
    "HEALTH_AGENT_WRITER_TOKEN",
    {
      body: JSON.stringify({
        p_expected_status: expectedStatus,
        p_id: id,
      }),
      method: "POST",
    },
    (value) => isRecord(value) || (Array.isArray(value) && value.length === 1),
  );
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
    (source !== "link" &&
      source !== "directory" &&
      source !== "quality" &&
      source !== "sentry") ||
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
    ...(typeof (value.sentryIssueId ?? value.sentry_issue_id) === "string"
      ? {
          sentryIssueId: String(value.sentryIssueId ?? value.sentry_issue_id),
        }
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
    input.batchKind &&
    input.batchKind !== "manager" &&
    isRecord(value) &&
    value[input.batchKind] !== undefined
      ? value[input.batchKind]
      : value;
  const findings = findingsFromArtifact(selected).map(repairFindingFromValue);
  const snapshot =
    input.batchKind === "manager"
      ? managerRepairSnapshot(
          findings,
          new Set(
            (
              await execFileAsync("git", ["ls-files"], {
                encoding: "utf8",
                maxBuffer: 2 * 1024 * 1024,
              })
            ).stdout
              .split("\n")
              .filter(Boolean),
          ),
        )
      : snapshotClaimedFindings(findings);
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
  if (!input.deferDelivery && !delivery) {
    throw new Error("repair_result_delivery_unavailable");
  }
  const [agentHub, slack] = input.deferDelivery
    ? ([{ status: "fulfilled" }, { status: "fulfilled" }] as const)
    : await Promise.allSettled([
        delivery!.agentHub(envelope),
        delivery!.slack(report),
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

export async function deliverRepairFailure(
  input: RepairFailureInput,
  dependencies: WorkflowRuntimeDependencies = createWorkflowRuntimeDependencies(),
): Promise<JsonObject> {
  const metadata = await readBoundedJson(
    input.metadataPath,
    filesFor(dependencies),
  );
  const snapshot = await readRepairSnapshot(input.snapshotPath, dependencies);
  const ids = claimedFindingIds(metadata, input.mergePolicy);
  if (ids.length === 0 || snapshot.findings.length === 0) {
    throw new Error("repair_failure_findings_empty");
  }

  const reason = input.reason ?? "repair_validation_failed_after_two_cycles";
  await Promise.all(
    ids.map((id) =>
      supabaseRequest(
        dependencies,
        "transition_health_fix_needs_human",
        "/rest/v1/rpc/transition_health_fix",
        "HEALTH_AGENT_WRITER_TOKEN",
        {
          body: JSON.stringify({
            p_confirmation_data: null,
            p_deployed_at: null,
            p_expected_status: "claimed",
            p_id: id,
            p_last_error: reason,
            p_lease_owner: input.leaseOwner,
            p_merge_sha: null,
            p_new_status: "needs_human",
            p_next_attempt_at: null,
            p_pr_number: null,
            p_pr_url: null,
          }),
          method: "POST",
        },
        (value) =>
          isRecord(value) || (Array.isArray(value) && value.length === 1),
      ),
    ),
  );

  const failures: string[] = input.expectedEscalation ? [] : [reason];
  const linearOutcomes: JsonValue[] = [];

  const envelope = buildPrResultEnvelope({
    mergePolicy: input.mergePolicy,
    mode: "live",
    result: {
      autoMergeEnabled: false,
      findings: snapshot.findings.map((finding) => ({
        changedFiles: finding.changedFiles ?? [],
        fingerprint: finding.fingerprint,
        source: finding.source,
        status: "needs_human",
      })),
      fixed: false,
      linearRequired: false,
      mergePolicy: input.mergePolicy,
      merged: false,
      snapshotId: snapshot.snapshotId,
      status: "needs_human",
    },
    runAt: input.runAt,
    snapshotId: snapshot.snapshotId,
    status: input.expectedEscalation ? "awaiting_human" : "failed",
    workflowAttempt: input.workflowAttempt,
    workflowRunId: input.workflowRunId,
  });
  const delivery = dependencies.delivery;
  const report: SlackDigestInput = {
    actionableFindings: snapshot.findings,
    failures,
    linearOutcomes,
    prOutcomes: [
      {
        auto_merge_enabled: false,
        merge_policy: input.mergePolicy,
        merged: false,
        status: "needs_human",
      },
    ],
    skippedActions: [],
  };
  if (!input.deferDelivery && !delivery) {
    throw new Error("repair_failure_delivery_unavailable");
  }
  const [agentHub, slack] = input.deferDelivery
    ? ([{ status: "fulfilled" }, { status: "fulfilled" }] as const)
    : await Promise.allSettled([
        delivery!.agentHub(envelope),
        delivery!.slack(report),
      ]);
  const result: JsonObject = {
    agent_hub: agentHub.status,
    claimed_finding_ids: ids,
    failures,
    linear_outcomes: linearOutcomes,
    merge_policy: input.mergePolicy,
    slack: slack.status,
    status: "needs_human",
  };
  await writeRedactedJson(input.outputPath, result, filesFor(dependencies));
  if (agentHub.status === "rejected" || slack.status === "rejected") {
    throw new Error("repair_failure_delivery_failed");
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
    case "admit-run":
      return admitHealthAgentRun(
        {
          mode: safeMode(input.mode),
          outputPath: safeString(input.outputPath, "outputPath"),
          runAt: safeString(input.runAt, "runAt"),
          terminalOutputPath:
            typeof input.terminalOutputPath === "string"
              ? input.terminalOutputPath
              : undefined,
          workflowAttempt: safeAttempt(input.workflowAttempt),
          workflowRunId: safeString(input.workflowRunId, "workflowRunId"),
        },
        dependencies,
      );
    case "collect-cron-health":
      return collectCronHealthArtifact(
        {
          outputPath: safeString(input.outputPath, "outputPath"),
          runAt: safeString(input.runAt, "runAt"),
        },
        dependencies,
      );
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
    case "collect-brand-review":
      return collectBrandReview(
        {
          mode: safeString(input.mode, "mode"),
          deferDelivery: input.deferDelivery === true,
          mutate: input.mutate === true,
          outputPath: safeString(input.outputPath, "outputPath"),
          runAt: safeString(input.runAt, "runAt"),
          windowHours:
            typeof input.windowHours === "number"
              ? input.windowHours
              : undefined,
          workflowAttempt: String(safeAttempt(input.workflowAttempt)),
          workflowRunId: safeString(input.workflowRunId, "workflowRunId"),
        },
        dependencies,
      );
    case "collect-trail-supply":
      return collectTrailSupplyArtifact(
        {
          mode: safeMode(input.mode),
          outputPath: safeString(input.outputPath, "outputPath"),
          runAt: safeString(input.runAt, "runAt"),
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
          brandReviewArtifactPath:
            typeof input.brandReviewArtifactPath === "string"
              ? input.brandReviewArtifactPath
              : undefined,
          cronArtifactPath:
            typeof input.cronArtifactPath === "string"
              ? input.cronArtifactPath
              : undefined,
          deferDelivery: input.deferDelivery === true,
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
          qualityArtifactPath: safeString(
            input.qualityArtifactPath,
            "qualityArtifactPath",
          ),
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
          workflowUrl:
            typeof input.workflowUrl === "string"
              ? input.workflowUrl
              : undefined,
        },
        dependencies,
      );
    case "final-report":
      return deliverFinalHealthReport(
        {
          aggregateArtifactPath:
            typeof input.aggregateArtifactPath === "string"
              ? input.aggregateArtifactPath
              : undefined,
          automaticPrResultPath:
            typeof input.automaticPrResultPath === "string"
              ? input.automaticPrResultPath
              : undefined,
          deferDelivery: input.deferDelivery === true,
          humanPrResultPath:
            typeof input.humanPrResultPath === "string"
              ? input.humanPrResultPath
              : undefined,
          mode: safeMode(input.mode),
          outputPath: safeString(input.outputPath, "outputPath"),
          phases: {
            analyze: safePhaseStatus(input.analyzeStatus),
            collect: safePhaseStatus(input.collectStatus),
            deliver: safePhaseStatus(input.deliverStatus),
            publish: safePhaseStatus(input.publishStatus),
            repair: safePhaseStatus(input.repairStatus),
          },
          queueArtifactPath:
            typeof input.queueArtifactPath === "string"
              ? input.queueArtifactPath
              : undefined,
          runAt: safeString(input.runAt, "runAt"),
          workflowAttempt: safeAttempt(input.workflowAttempt),
          workflowRunId: safeString(input.workflowRunId, "workflowRunId"),
          workflowUrl:
            typeof input.workflowUrl === "string"
              ? input.workflowUrl
              : undefined,
        },
        dependencies,
      );
    case "finalize-run":
      return finalizeHealthAgentRun(
        {
          mode: safeMode(input.mode),
          outputPath: safeString(input.outputPath, "outputPath"),
          resultPath:
            typeof input.resultPath === "string" ? input.resultPath : undefined,
          runAt: safeString(input.runAt, "runAt"),
          status: input.status === "failed" ? "failed" : "success",
          workflowAttempt: safeAttempt(input.workflowAttempt),
          workflowRunId: safeString(input.workflowRunId, "workflowRunId"),
        },
        dependencies,
      );
    case "record-artifact-upload":
      return recordArtifactUploadOutcome(
        {
          inputPath: safeString(input.inputPath, "inputPath"),
          outputPath: safeString(input.outputPath, "outputPath"),
          reason:
            typeof input.reason === "string"
              ? input.reason.trim().slice(0, 300)
              : undefined,
          status: input.status === "success" ? "success" : "failed",
        },
        dependencies,
      );
    case "terminal-status":
      return writeTerminalStatus(
        {
          artifactStatus: safeString(input.artifactStatus, "artifactStatus"),
          finalReportStatus: safeString(
            input.finalReportStatus,
            "finalReportStatus",
          ),
          managerReportStatus: safeString(
            input.managerReportStatus,
            "managerReportStatus",
          ),
          outputPath: safeString(input.outputPath, "outputPath"),
          uploadClassifierStatus: safeString(
            input.uploadClassifierStatus,
            "uploadClassifierStatus",
          ),
          uploadRetryStatus: safeString(
            input.uploadRetryStatus,
            "uploadRetryStatus",
          ),
          uploadStatus: safeString(input.uploadStatus, "uploadStatus"),
        },
        dependencies,
      );
    case "cleanup-stale-branches":
      return cleanupStaleBranches(
        {
          aggregateArtifactPath: safeString(
            input.aggregateArtifactPath,
            "aggregateArtifactPath",
          ),
          canaryFingerprints: Array.isArray(input.canaryFingerprints)
            ? input.canaryFingerprints.filter(
                (value): value is string => typeof value === "string",
              )
            : undefined,
          mode: safeMode(input.mode),
          outputPath: safeString(input.outputPath, "outputPath"),
          runAt: safeString(input.runAt, "runAt"),
          runIdentity: safeString(input.runIdentity, "runIdentity"),
          workflowAttempt: safeAttempt(input.workflowAttempt),
          workflowRunId: safeString(input.workflowRunId, "workflowRunId"),
        },
        dependencies,
      );
    case "release-claims":
      return releaseUnattemptedClaims(
        {
          leaseOwner: safeString(input.leaseOwner, "leaseOwner"),
          outputPath: safeString(input.outputPath, "outputPath"),
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
            input.batchKind === "automatic" ||
            input.batchKind === "human" ||
            input.batchKind === "manager"
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
          deferDelivery: input.deferDelivery === true,
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
    case "repair-failure":
      return deliverRepairFailure(
        {
          expectedEscalation: input.expectedEscalation === true,
          deferDelivery: input.deferDelivery === true,
          leaseOwner: safeString(input.leaseOwner, "leaseOwner"),
          mergePolicy:
            input.mergePolicy === "automatic" || input.mergePolicy === "human"
              ? input.mergePolicy
              : (() => {
                  throw new Error("invalid_merge_policy");
                })(),
          metadataPath: safeString(input.metadataPath, "metadataPath"),
          outputPath: safeString(input.outputPath, "outputPath"),
          reason:
            typeof input.reason === "string"
              ? safeString(input.reason, "reason")
              : undefined,
          runAt: safeString(input.runAt, "runAt"),
          snapshotPath: safeString(input.snapshotPath, "snapshotPath"),
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
  const windowHours = optionalArgument(argv, "--window-hours");
  const input: Record<string, unknown> = {
    aggregateArtifactPath: optionalArgument(argv, "--aggregate-artifact"),
    analyzeStatus: optionalArgument(argv, "--analyze-status"),
    auditPath: optionalArgument(argv, "--audit"),
    batchKind: optionalArgument(argv, "--batch"),
    brandReviewArtifactPath: optionalArgument(argv, "--brand-review-artifact"),
    cronArtifactPath: optionalArgument(argv, "--cron-artifact"),
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
    mutate: optionalArgument(argv, "--mutate") === "true",
    outputPath: requiredArgument(argv, "--output"),
    prNumber: optionalArgument(argv, "--pr-number"),
    prUrl: optionalArgument(argv, "--pr-url"),
    qualityArtifactPath: optionalArgument(argv, "--quality-artifact"),
    resultPath: optionalArgument(argv, "--result"),
    reason: optionalArgument(argv, "--reason"),
    runIdentity:
      optionalArgument(argv, "--run-identity") ??
      optionalArgument(argv, "--run-id"),
    runAt: optionalArgument(argv, "--run-at"),
    sentryArtifactPath: optionalArgument(argv, "--sentry-artifact"),
    snapshotPath: optionalArgument(argv, "--snapshot"),
    status: optionalArgument(argv, "--status"),
    terminalOutputPath: optionalArgument(argv, "--terminal-output"),
    uploadClassifierStatus: optionalArgument(
      argv,
      "--upload-classifier-status",
    ),
    uploadRetryStatus: optionalArgument(argv, "--upload-retry-status"),
    uploadStatus: optionalArgument(argv, "--upload-status"),
    workflowAttempt: attempt ? Number(attempt) : undefined,
    workflowRunId: optionalArgument(argv, "--run-id"),
    workflowUrl: optionalArgument(argv, "--workflow-url"),
    windowHours: windowHours ? Number(windowHours) : 25,
    autoMergeEnabled: optionalArgument(argv, "--auto-merge-enabled") === "true",
    automaticPrResultPath: optionalArgument(argv, "--automatic-pr-result"),
    artifactStatus: optionalArgument(argv, "--artifact-status"),
    collectStatus: optionalArgument(argv, "--collect-status"),
    deferDelivery: optionalArgument(argv, "--defer-delivery") === "true",
    deliverStatus: optionalArgument(argv, "--deliver-status"),
    expectedEscalation:
      optionalArgument(argv, "--expected-escalation") === "true",
    finalReportStatus: optionalArgument(argv, "--final-report-status"),
    managerReportStatus: optionalArgument(argv, "--manager-report-status"),
    humanPrResultPath: optionalArgument(argv, "--human-pr-result"),
    publishStatus: optionalArgument(argv, "--publish-status"),
    queueArtifactPath: optionalArgument(argv, "--queue-artifact"),
    repairStatus: optionalArgument(argv, "--repair-status"),
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
  main().catch((error) => {
    console.error(
      `Health agent workflow runtime failed: ${safeRuntimeFailure(error)}`,
    );
    process.exitCode = 1;
  });
}
