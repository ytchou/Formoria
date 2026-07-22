import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  evaluateDirectoryHealth,
  type DirectoryHealthInput,
} from "./directory";
import {
  collectSentryFindings,
  SentryClassificationSchema,
  buildSentryHealthFinding,
  type SentryClassifier,
  type SentryFindingsOptions,
  type SanitizedSentryIssue,
  type SentryClassification,
} from "./sentry";
import {
  clusterRepairFindings,
  partitionRepairBatch,
  snapshotClaimedFindings,
  type RepairBatch,
  type RepairFinding,
  type RepairPartition,
  type RepairResult,
  type RepairSnapshot,
} from "./repair";
import {
  requiresHumanPolicy,
  stableFingerprint,
  type AuditLogger,
  type HealthFinding,
  type HealthSource,
  type JsonValue,
  type MergePolicy,
} from "./contracts";

const MAX_ARTIFACT_BYTES = 512 * 1024;
const MAX_RESULT_BYTES = 512 * 1024;
const MAX_FINDINGS = 10_000;
const MAX_SENTRY_ISSUES = 20;
const MAX_TEXT_LENGTH = 2_000;
const TAIPEI_TIME_ZONE = "Asia/Taipei";
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

export const HEALTH_AGENT_MODES = ["preflight", "live", "canary_fix"] as const;
export type HealthAgentMode = (typeof HEALTH_AGENT_MODES)[number];

export const HEALTH_ROUTINES = [
  "link-checker",
  "directory-health",
  "sentry-triage",
] as const;
export type HealthRoutine = (typeof HEALTH_ROUTINES)[number];

export const HEALTH_AGENT_COMMANDS = [
  "link-request",
  "sentry-collect",
  "directory-collect",
  "aggregate-and-deliver",
  "enqueue-claim-batch",
  "pr-result-envelope",
] as const;
export type HealthAgentCommand = (typeof HEALTH_AGENT_COMMANDS)[number];

export type HealthAgentCommandAlias =
  | HealthAgentCommand
  | "construct-link-request"
  | "collect-sentry-artifact"
  | "collect-directory-artifact"
  | "enqueue-claim-policy-batches"
  | "pr-result";

type JsonObject = Record<string, JsonValue>;
type Environment = Readonly<Record<string, string | undefined>>;

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string().max(MAX_TEXT_LENGTH),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema).max(200),
    z.record(z.string().max(120), jsonValueSchema),
  ]),
);

const healthFindingSchema = z
  .object({
    evidence: z.record(z.string().max(120), jsonValueSchema),
    fingerprint: z.string().trim().min(1).max(500),
    humanReason: z.string().trim().min(1).max(MAX_TEXT_LENGTH).optional(),
    mergePolicy: z.enum(["automatic", "human"]),
    sentryIssueId: z.string().trim().min(1).max(500).optional(),
    severity: z.enum(["low", "medium", "high", "critical"]),
    source: z.enum(["link", "directory", "sentry"]),
    title: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  })
  .strict();

export interface ArtifactFileSystem {
  readFile(path: string, encoding?: "utf8"): Promise<string>;
  writeFile(path: string, contents: string, encoding?: "utf8"): Promise<void>;
}

export interface JsonFileStore {
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
}

type FileSystemLike = ArtifactFileSystem | JsonFileStore;

const defaultFileSystem: ArtifactFileSystem = {
  readFile: (path) => readFile(path, "utf8"),
  writeFile: (path, contents) => writeFile(path, contents, "utf8"),
};

const sensitiveKey =
  /(?:authorization|cookie|csrf|token|secret|password|credential|private.?key|api.?key|webhook|raw.?sentry|sentry.?payload|database.?url|db.?url|request|body|payload|headers?|user(?:s|_id)?|email|session|dsn|connection.?string)/i;
const sensitiveValue =
  /(?:bearer\s+[a-z0-9._~+\-/]+=*|postgres(?:ql)?:\/\/|hooks\.slack\.com\/services\/|(?:ghp|gho|github_pat|xox[baprs]-)[a-z0-9_-]{8,}|sk-[a-z0-9_-]{8,})/i;
const inlineSensitiveValue =
  /\b(?:authorization|cookie|csrf|token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi;
const urlValue = /\b(?:https?|ftp):\/\/[^\s<>'"]+/gi;
const postgresUrlValue = /\bpostgres(?:ql)?:\/\/[^\s<>'"]+/gi;
const emailValue = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function redactText(value: string): string {
  return value
    .replace(sensitiveValue, "[redacted]")
    .replace(postgresUrlValue, "[redacted-db-url]")
    .replace(inlineSensitiveValue, "[redacted-secret]")
    .replace(emailValue, "[redacted-identifier]")
    .replace(urlValue, "[redacted-url]")
    .slice(0, MAX_TEXT_LENGTH);
}

function redactJsonValue(
  value: unknown,
  key = "",
  depth = 0,
): JsonValue | undefined {
  if (depth > 6 || sensitiveKey.test(key)) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, 200)
      .map((item) => redactJsonValue(item, key, depth + 1))
      .filter((item): item is JsonValue => item !== undefined);
  }
  if (typeof value !== "object") return undefined;

  const result: JsonObject = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 200)) {
    const safeKey = childKey
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 120);
    if (!safeKey) continue;
    const safeValue = redactJsonValue(childValue, safeKey, depth + 1);
    if (safeValue !== undefined) result[safeKey] = safeValue;
  }
  return result;
}

export function redactForAudit(value: unknown, depth = 0): JsonValue {
  if (depth > 6) return "[REDACTED_DEPTH]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => redactForAudit(item, depth + 1));
  }
  if (typeof value !== "object") return String(value).slice(0, MAX_TEXT_LENGTH);
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    result[key] = sensitiveKey.test(key)
      ? "[REDACTED]"
      : redactForAudit(item, depth + 1);
  }
  return result;
}

function redactedRecord(value: unknown): JsonObject {
  const result = redactJsonValue(value);
  return result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error && error.name.trim()
    ? error.name
    : "operation_failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertBoundedJson(value: unknown, limit = MAX_ARTIFACT_BYTES): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    throw new Error("JSON value is not serializable");
  }
  if (new TextEncoder().encode(serialized).byteLength > limit) {
    throw new Error("JSON value exceeds size limit");
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function environmentValue(dependencies: HealthAgentDependencies): Environment {
  return dependencies.env ?? process.env;
}

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function mutationPolicy(
  mode: HealthAgentMode,
  environment: Environment = process.env,
): { autofix: boolean; business: boolean } {
  if (mode === "preflight") return { autofix: false, business: false };
  if (mode === "canary_fix") return { autofix: true, business: true };
  const business = isEnabled(environment.HEALTH_AGENT_ENABLED);
  return {
    autofix: business && isEnabled(environment.HEALTH_AUTOFIX_ENABLED),
    business,
  };
}

function nowFor(dependencies: HealthAgentDependencies): Date {
  return dependencies.now?.() ?? new Date();
}

function validRunAt(value: string | Date | undefined): string {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new Error("Invalid run time");
  return date.toISOString();
}

export function taipeiDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid run time");
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function routineSourceId(
  workflowRunId: string | number,
  workflowAttempt: number,
  routine: string,
): string {
  const runId = String(workflowRunId).trim();
  if (!runId || !SAFE_IDENTITY.test(runId))
    throw new Error("Invalid workflow run identity");
  if (!Number.isSafeInteger(workflowAttempt) || workflowAttempt < 1) {
    throw new Error("Invalid workflow attempt");
  }
  if (!SAFE_IDENTITY.test(routine)) throw new Error("Invalid routine identity");
  return `github-actions:${runId}:attempt-${workflowAttempt}:${routine}`;
}

export interface LinkHealthRequest {
  body: {
    dry_run: boolean;
    run_identity: string;
    workflow_attempt: number;
  };
  headers: {
    "content-type": "application/json";
  };
  method: "POST";
  url: string;
}

export interface LinkHealthRequestInput {
  endpoint?: string;
  dryRun?: boolean;
  mode?: HealthAgentMode;
  originSecret?: string;
  railwayUrl?: string;
  runIdentity?: string;
  workflowAttempt: number;
  workflowRunId?: string | number;
}

function safeEndpoint(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("Invalid link health endpoint");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function buildLinkHealthRequest(
  input: LinkHealthRequestInput,
): LinkHealthRequest {
  if (
    !Number.isSafeInteger(input.workflowAttempt) ||
    input.workflowAttempt < 1
  ) {
    throw new Error("Invalid workflow attempt");
  }
  const endpoint =
    input.endpoint ??
    (input.railwayUrl
      ? `${safeEndpoint(input.railwayUrl)}/api/cron/link-health`
      : undefined);
  if (!endpoint) throw new Error("Link health endpoint is required");
  const runIdentity =
    input.runIdentity ??
    (input.workflowRunId
      ? `${input.workflowRunId}:attempt-${input.workflowAttempt}`
      : undefined);
  if (!runIdentity || !SAFE_IDENTITY.test(runIdentity)) {
    throw new Error("Invalid workflow run identity");
  }
  return {
    body: {
      dry_run: input.dryRun ?? input.mode === "preflight",
      run_identity: runIdentity,
      workflow_attempt: input.workflowAttempt,
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: safeEndpoint(endpoint),
  };
}

export interface LinkHealthExecutionDependencies {
  audit?: AuditLogger;
  fetchImplementation?: typeof fetch;
  originSecret?: string;
}

export async function executeLinkHealthRequest(
  request: LinkHealthRequest,
  dependencies: LinkHealthExecutionDependencies = {},
): Promise<JsonObject> {
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const headers: Record<string, string> = { ...request.headers };
  if (dependencies.originSecret)
    headers["x-origin-verify"] = dependencies.originSecret;
  const startedAt = performance.now();
  try {
    const response = await fetchImplementation(request.url, {
      body: JSON.stringify(request.body),
      headers,
      method: request.method,
    });
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_ARTIFACT_BYTES) {
      throw new Error("Link health response exceeds size limit");
    }
    if (!response.ok) {
      emitAudit(
        { audit: dependencies.audit },
        {
          adapter: "link-health",
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          operation: "invoke_link_health",
          request: request.body,
          response: { httpStatus: response.status, error: "request_failed" },
          schemaValid: true,
          status: "failure",
        },
      );
      throw new Error("Link health request failed");
    }
    const parsed = text ? JSON.parse(text) : {};
    assertBoundedJson(parsed);
    if (!isRecord(parsed)) throw new Error("Link health response is invalid");
    const result = redactedRecord(parsed);
    result.latency_ms = Math.max(0, Math.round(performance.now() - startedAt));
    emitAudit(
      { audit: dependencies.audit },
      {
        adapter: "link-health",
        latencyMs: result.latency_ms as number,
        operation: "invoke_link_health",
        request: request.body,
        response: { httpStatus: response.status },
        schemaValid: true,
        status: "success",
      },
    );
    return result;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Link health request failed"
    ) {
      throw error;
    }
    emitAudit(
      { audit: dependencies.audit },
      {
        adapter: "link-health",
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        operation: "invoke_link_health",
        request: request.body,
        response: { error: safeErrorCode(error) },
        schemaValid: false,
        status: "failure",
      },
    );
    throw new Error("Link health request failed");
  }
}

export interface HealthCollectorArtifact {
  collectedAt: string;
  evidence: JsonObject;
  failure?: string;
  failures: string[];
  findings: HealthFinding[];
  routine: HealthRoutine;
  skippedActions: string[];
  snapshot?: JsonObject;
  status: "failed" | "skipped" | "success";
  version: 1;
}

export type CollectorArtifact = HealthCollectorArtifact;

function redactedFinding(finding: HealthFinding): HealthFinding {
  return {
    evidence: redactedRecord(finding.evidence),
    fingerprint: redactText(finding.fingerprint),
    ...(finding.humanReason
      ? { humanReason: redactText(finding.humanReason) }
      : {}),
    mergePolicy: finding.mergePolicy,
    ...(finding.sentryIssueId
      ? { sentryIssueId: redactText(finding.sentryIssueId) }
      : {}),
    severity: finding.severity,
    source: finding.source,
    title: redactText(finding.title),
  };
}

function safeFingerprintSegment(value: string): string {
  return (
    redactText(value)
      .toLowerCase()
      .replace(/[^a-z0-9._:-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

function validateHealthFinding(value: unknown): HealthFinding {
  return healthFindingSchema.parse(value) as HealthFinding;
}

function normalizedFindings(value: unknown): HealthFinding[] {
  if (!Array.isArray(value) || value.length > MAX_FINDINGS) {
    throw new Error("Collector findings are invalid");
  }
  return value.map((item) => redactedFinding(validateHealthFinding(item)));
}

function normalizedStatus(value: unknown): HealthCollectorArtifact["status"] {
  if (value === "success" || value === "failed" || value === "skipped")
    return value;
  throw new Error("Collector status is invalid");
}

function normalizeCollectorArtifact(
  value: unknown,
  expectedRoutine?: HealthRoutine,
): HealthCollectorArtifact {
  assertBoundedJson(value);
  if (!isRecord(value)) throw new Error("Collector artifact must be an object");
  if (value.version !== 1) {
    throw new Error("Collector artifact version is invalid");
  }
  const routine = value.routine;
  if (!HEALTH_ROUTINES.includes(routine as HealthRoutine)) {
    throw new Error("Collector routine is invalid");
  }
  if (expectedRoutine && routine !== expectedRoutine) {
    throw new Error("Collector routine does not match the expected artifact");
  }
  if (typeof value.collectedAt !== "string" || !value.collectedAt.trim()) {
    throw new Error("Collector timestamp is invalid");
  }
  if (!isRecord(value.evidence)) {
    throw new Error("Collector evidence is invalid");
  }
  if (!Array.isArray(value.findings)) {
    throw new Error("Collector findings are invalid");
  }
  if (!Array.isArray(value.failures)) {
    throw new Error("Collector failures are invalid");
  }
  if (!Array.isArray(value.skippedActions)) {
    throw new Error("Collector skipped actions are invalid");
  }
  if (value.failure !== undefined && typeof value.failure !== "string") {
    throw new Error("Collector failure is invalid");
  }
  if (value.snapshot !== undefined && !isRecord(value.snapshot)) {
    throw new Error("Collector snapshot is invalid");
  }
  const status = normalizedStatus(value.status);
  const findings = normalizedFindings(value.findings);
  const snapshot = redactedRecord(value.snapshot ?? value.evidence ?? {});
  if (value.failures.some((item) => typeof item !== "string")) {
    throw new Error("Collector failures are invalid");
  }
  if (value.skippedActions.some((item) => typeof item !== "string")) {
    throw new Error("Collector skipped actions are invalid");
  }
  const failures = value.failures;
  const failure = stringValue(value.failure) ?? failures.at(0);
  const skippedActions = value.skippedActions;
  validRunAt(value.collectedAt);
  return {
    collectedAt: value.collectedAt,
    evidence: redactedRecord(value.evidence),
    ...(failure ? { failure: redactText(failure) } : {}),
    failures: failures.map(redactText),
    findings,
    routine: routine as HealthRoutine,
    skippedActions: skippedActions.map(redactText),
    snapshot,
    status,
    version: 1,
  };
}

export function validateCollectorArtifact(
  value: unknown,
): HealthCollectorArtifact {
  return normalizeCollectorArtifact(value);
}

function runAtForArtifact(value?: string): string {
  return validRunAt(value);
}

export function failedCollectorArtifact(
  routine: HealthRoutine,
  runAt?: string,
  reason = "collector_artifact_unavailable",
): HealthCollectorArtifact {
  return {
    collectedAt: runAtForArtifact(runAt),
    evidence: {},
    failure: redactText(reason),
    failures: ["collector_artifact_unavailable"],
    findings: [],
    routine,
    skippedActions: [],
    snapshot: {},
    status: "failed",
    version: 1,
  };
}

async function readText(files: FileSystemLike, path: string): Promise<string> {
  if ("readFile" in files) return files.readFile(path, "utf8");
  return files.read(path);
}

async function writeText(
  files: FileSystemLike,
  path: string,
  contents: string,
): Promise<void> {
  if ("writeFile" in files) {
    await files.writeFile(path, contents, "utf8");
    return;
  }
  await files.write(path, contents);
}

export async function readBoundedJson(
  path: string,
  files: FileSystemLike = defaultFileSystem,
): Promise<unknown> {
  const text = await readText(files, path);
  if (new TextEncoder().encode(text).byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error("Artifact exceeds size limit");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Artifact is not valid JSON");
  }
}

export async function writeRedactedJson(
  path: string,
  value: unknown,
  files: FileSystemLike = defaultFileSystem,
): Promise<void> {
  const contents = `${JSON.stringify(redactedRecord(value), null, 2)}\n`;
  if (new TextEncoder().encode(contents).byteLength > MAX_RESULT_BYTES) {
    throw new Error("Result exceeds size limit");
  }
  await writeText(files, path, contents);
}

export async function loadCollectorArtifact(
  routine: HealthRoutine,
  path: string,
  runAt?: string,
  files: FileSystemLike = defaultFileSystem,
): Promise<HealthCollectorArtifact> {
  try {
    return normalizeCollectorArtifact(
      await readBoundedJson(path, files),
      routine,
    );
  } catch (error) {
    return failedCollectorArtifact(
      routine,
      runAt,
      `${safeErrorCode(error)}:collector_artifact_unavailable`,
    );
  }
}

export interface HealthAuditRecord {
  adapter: string;
  latencyMs: number;
  operation: string;
  request: JsonObject;
  response: JsonObject;
  schemaValid: boolean;
  status: "failure" | "success" | "suppressed";
}

function emitAudit(
  dependencies: HealthAgentDependencies,
  record: Omit<HealthAuditRecord, "request" | "response"> & {
    request?: unknown;
    response?: unknown;
  },
): void {
  const audit = dependencies.audit;
  if (!audit) return;
  try {
    audit({
      ...record,
      request: redactedRecord(record.request ?? {}),
      response: redactedRecord(record.response ?? {}),
    });
  } catch {
    // Audit failures must not alter health-agent behavior.
  }
}

export interface SentryCollectionContext {
  artifactPath: string;
  mode: HealthAgentMode;
}

export type SentryCollectionProvider = (
  input: SentryCollectionContext,
) => Promise<unknown>;

export interface DirectoryCollectionContext {
  artifactPath: string;
  link: HealthCollectorArtifact;
  mode: HealthAgentMode;
}

export type DirectoryCollectionProvider = (
  input: DirectoryCollectionContext,
) => Promise<unknown>;

export interface CollectorDependencies {
  directory?: DirectoryCollectionProvider;
  sentry?: SentryCollectionProvider;
}

export interface SentryArtifactCommandInput {
  classifier?: SentryClassifier;
  collector?: SentryCollectionProvider;
  mode?: HealthAgentMode;
  options?: Omit<SentryFindingsOptions, "classifier">;
  outputPath: string;
  runAt?: string;
}

function artifactFromProvider(
  routine: HealthRoutine,
  value: unknown,
): HealthCollectorArtifact {
  assertBoundedJson(value);
  if (
    isRecord(value) &&
    value.routine === routine &&
    value.status !== undefined
  ) {
    return normalizeCollectorArtifact(value, routine);
  }
  if (!isRecord(value)) throw new Error("Collector result is invalid");
  const findings = normalizedFindings(value.findings ?? []);
  const snapshot: JsonObject = isRecord(value.snapshot)
    ? redactedRecord(value.snapshot)
    : {};
  if (Object.keys(snapshot).length > 0) {
    return {
      collectedAt: new Date().toISOString(),
      evidence: {},
      failures: [],
      findings,
      routine,
      skippedActions: [],
      snapshot,
      status: "success",
      version: 1,
    };
  }
  for (const key of [
    "analyzedIssueCount",
    "candidateIssueCount",
    "incidentMode",
    "hasMore",
    "requestCount",
    "checked",
  ]) {
    const candidate = value[key];
    if (
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      typeof candidate === "boolean" ||
      candidate === null
    ) {
      snapshot[key] = candidate;
    }
  }
  return {
    collectedAt: new Date().toISOString(),
    evidence: {},
    failures: [],
    findings,
    routine,
    skippedActions: [],
    snapshot,
    status: "success",
    version: 1,
  };
}

export function makeLinkArtifact(
  summary: unknown,
  runAt?: string,
): HealthCollectorArtifact {
  assertBoundedJson(summary);
  if (!isRecord(summary)) throw new Error("Link health summary is invalid");
  const cleanupRequired = Array.isArray(summary.cleanupRequired)
    ? summary.cleanupRequired.filter(isRecord)
    : [];
  if (cleanupRequired.length > MAX_FINDINGS) {
    throw new Error("Link cleanup findings are invalid");
  }
  const findings = cleanupRequired.map((row): HealthFinding => {
    const brandId = stringValue(row.brandId) ?? "unknown-brand";
    const field = stringValue(row.field) ?? "unknown-field";
    const fingerprintIdentity = `${safeFingerprintSegment(brandId)}:${safeFingerprintSegment(field)}`;
    return {
      evidence: {
        brandId: redactText(brandId),
        cleanupRequired: true,
        field: redactText(field),
      },
      fingerprint: stableFingerprint(
        "link",
        "cleanup-required",
        fingerprintIdentity,
      ),
      humanReason: "Link, image, and brand-field cleanup are human-owned",
      mergePolicy: "human",
      severity: "medium",
      source: "link",
      title: "Link cleanup requires review",
    };
  });
  const snapshot = redactedRecord({
    blocked: summary.blocked,
    broken: summary.broken,
    checked: summary.checked,
    cleanupRequired: cleanupRequired.map((row) => redactedRecord(row)),
    failingRows: Array.isArray(summary.failingRows)
      ? summary.failingRows.map((row) => redactedRecord(row))
      : [],
    heroBroken: summary.heroBroken,
    heroExternal: summary.heroExternal,
    ok: summary.ok,
    severity: summary.severity,
  });
  return {
    collectedAt: runAtForArtifact(runAt),
    evidence: {},
    failures: [],
    findings,
    routine: "link-checker",
    skippedActions: [],
    snapshot,
    status: "success",
    version: 1,
  };
}

export function makeDirectoryArtifact(
  input: DirectoryHealthInput,
  runAt?: string,
): HealthCollectorArtifact {
  const result = evaluateDirectoryHealth(input);
  const artifact = artifactFromProvider("directory-health", result);
  return { ...artifact, collectedAt: runAtForArtifact(runAt) };
}

export interface SentryCollectionSummary {
  candidateIssueCount: number;
  hasMore: boolean;
  incidentMode: boolean;
  issues: readonly SanitizedSentryIssue[];
  requestCount: number;
}

export function finalizeSentryArtifact(
  collection: SentryCollectionSummary,
  classifications: readonly SentryClassification[],
  runAt?: string,
): HealthCollectorArtifact {
  assertBoundedJson(collection);
  assertBoundedJson(classifications);
  if (collection.issues.length > MAX_SENTRY_ISSUES) {
    throw new Error("Sentry issue collection exceeds size limit");
  }
  if (classifications.length !== collection.issues.length) {
    throw new Error("Sentry classifications must cover the collected issues");
  }
  const findings = collection.issues.map((issue, index) => {
    const candidate = classifications[index];
    if (!candidate) throw new Error("Sentry classification is missing");
    const classification = SentryClassificationSchema.parse(candidate);
    return buildSentryHealthFinding(issue, classification, {
      incidentMode: collection.incidentMode,
    });
  });
  return {
    collectedAt: runAtForArtifact(runAt),
    evidence: {},
    failures: [],
    findings,
    routine: "sentry-triage",
    skippedActions: [],
    snapshot: {
      candidateIssueCount: collection.candidateIssueCount,
      hasMore: collection.hasMore,
      incidentMode: collection.incidentMode,
      requestCount: collection.requestCount,
    },
    status: "success",
    version: 1,
  };
}

export async function collectSentryArtifact(
  input: SentryArtifactCommandInput | string,
  dependenciesOrCollector:
    HealthAgentDependencies | (() => Promise<unknown>) = {},
  legacyFiles?: FileSystemLike,
): Promise<HealthCollectorArtifact> {
  const command: SentryArtifactCommandInput =
    typeof input === "string" ? { outputPath: input } : input;
  const dependencies: HealthAgentDependencies =
    typeof dependenciesOrCollector === "function"
      ? {}
      : dependenciesOrCollector;
  const files = legacyFiles ?? resolveFiles(dependencies);
  let collector: SentryCollectionProvider | undefined =
    typeof dependenciesOrCollector === "function"
      ? async () => dependenciesOrCollector()
      : (command.collector ??
        dependencies.collectors?.sentry ??
        dependencies.sentryCollector);
  if (!collector && command.classifier) {
    collector = async () =>
      collectSentryFindings({
        ...(command.options ?? {}),
        audit: dependencies.audit,
        classifier: command.classifier as SentryClassifier,
      });
  }

  let artifact: HealthCollectorArtifact;
  try {
    if (!collector) throw new Error("Sentry collector is unavailable");
    artifact = artifactFromProvider(
      "sentry-triage",
      await collector({
        artifactPath: command.outputPath,
        mode: command.mode ?? "live",
      }),
    );
    artifact = { ...artifact, collectedAt: runAtForArtifact(command.runAt) };
  } catch (error) {
    artifact = failedCollectorArtifact(
      "sentry-triage",
      command.runAt,
      `${safeErrorCode(error)}:sentry_collection_failed`,
    );
  }
  await writeCollectorArtifact(command.outputPath, artifact, files);
  return artifact;
}

export interface DirectoryArtifactCommandInput {
  collector?: DirectoryCollectionProvider;
  input?: DirectoryHealthInput;
  linkArtifact?: HealthCollectorArtifact;
  linkArtifactPath?: string;
  mode?: HealthAgentMode;
  outputPath: string;
  runAt?: string;
}

function isDirectoryHealthInput(value: unknown): value is DirectoryHealthInput {
  return (
    isRecord(value) &&
    "approvedBrands" in value &&
    "links" in value &&
    "database" in value &&
    "dependabot" in value &&
    "branches" in value &&
    typeof value.nowIso === "string"
  );
}

export async function collectDirectoryArtifact(
  input: DirectoryArtifactCommandInput | string,
  outputPathOrDependencies?: string | HealthAgentDependencies,
  runAtOrFiles?: string | FileSystemLike,
  legacyCollector?: (link: HealthCollectorArtifact) => Promise<unknown>,
  legacyFiles?: FileSystemLike,
): Promise<HealthCollectorArtifact> {
  const command: DirectoryArtifactCommandInput =
    typeof input === "string"
      ? {
          linkArtifactPath: input,
          outputPath: outputPathOrDependencies as string,
          runAt: runAtOrFiles as string,
          collector: legacyCollector
            ? async ({ link }) => legacyCollector(link)
            : undefined,
        }
      : input;
  const dependencies: HealthAgentDependencies =
    typeof input === "string" ||
    !outputPathOrDependencies ||
    typeof outputPathOrDependencies === "string"
      ? {}
      : outputPathOrDependencies;
  const files =
    legacyFiles ??
    (typeof input === "string"
      ? runAtOrFiles && typeof runAtOrFiles !== "string"
        ? runAtOrFiles
        : defaultFileSystem
      : resolveFiles(dependencies));
  let link = command.linkArtifact;
  if (!link && command.linkArtifactPath) {
    link = await loadCollectorArtifact(
      "link-checker",
      command.linkArtifactPath,
      command.runAt,
      files,
    );
  }
  if (!link) {
    link = failedCollectorArtifact(
      "link-checker",
      command.runAt,
      "missing_link_artifact",
    );
  } else {
    try {
      link = normalizeCollectorArtifact(link, "link-checker");
    } catch (error) {
      link = failedCollectorArtifact(
        "link-checker",
        command.runAt,
        `${safeErrorCode(error)}:invalid_link_artifact`,
      );
    }
  }

  let artifact: HealthCollectorArtifact;
  try {
    if (link.status !== "success")
      throw new Error("upstream_link_artifact_failed");
    const collector = command.collector ?? dependencies.collectors?.directory;
    if (command.input) {
      const evaluated = evaluateDirectoryHealth(command.input);
      artifact = artifactFromProvider("directory-health", evaluated);
    } else {
      if (!collector) throw new Error("Directory collector is unavailable");
      const value = await collector({
        artifactPath: command.outputPath,
        link,
        mode: command.mode ?? "live",
      });
      artifact = isDirectoryHealthInput(value)
        ? artifactFromProvider(
            "directory-health",
            evaluateDirectoryHealth(value),
          )
        : artifactFromProvider("directory-health", value);
    }
    artifact = { ...artifact, collectedAt: runAtForArtifact(command.runAt) };
  } catch (error) {
    const reason =
      error instanceof Error &&
      error.message === "upstream_link_artifact_failed"
        ? "upstream_link_artifact_failed"
        : `${safeErrorCode(error)}:directory_collection_failed`;
    artifact = failedCollectorArtifact(
      "directory-health",
      command.runAt,
      reason,
    );
  }
  await writeCollectorArtifact(command.outputPath, artifact, files);
  return artifact;
}

async function writeCollectorArtifact(
  path: string,
  artifact: HealthCollectorArtifact,
  files: FileSystemLike,
): Promise<void> {
  const contents = `${JSON.stringify(redactedRecord(artifact), null, 2)}\n`;
  if (new TextEncoder().encode(contents).byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error("Collector artifact exceeds size limit");
  }
  await writeText(files, path, contents);
}

export interface HealthAgentEnvelope {
  data: JsonObject & { notification_owner: "github_actions" };
  date: string;
  project: "formoria";
  routine: HealthRoutine | "health-selfheal";
  run_at: string;
  source: "github_actions";
  source_run_id: string;
  status: "failed" | "skipped" | "success";
  tickets_created: string[];
  verdict_severity: "error" | "info" | "ok" | "warning" | "critical";
  verdict_text: string;
  version: 1;
}

function severityFor(
  artifact: HealthCollectorArtifact,
): HealthAgentEnvelope["verdict_severity"] {
  if (artifact.status === "failed") return "error";
  if (artifact.findings.some(({ severity }) => severity === "critical"))
    return "critical";
  if (artifact.findings.some(({ severity }) => severity === "high"))
    return "error";
  if (artifact.findings.length > 0) return "warning";
  return "ok";
}

export function createRoutineEnvelope(input: {
  artifact: HealthCollectorArtifact;
  runAt: string;
  tickets?: readonly string[];
  workflowAttempt: number;
  workflowRunId: string | number;
}): HealthAgentEnvelope {
  const runAt = validRunAt(input.runAt);
  const severity = severityFor(input.artifact);
  const findings = input.artifact.findings.map(redactedFinding);
  const status = input.artifact.status;
  return {
    data: {
      ...(input.artifact.failure
        ? { failure: redactText(input.artifact.failure) }
        : {}),
      finding_count: findings.length,
      findings: findings as unknown as JsonValue,
      notification_owner: "github_actions",
      snapshot: redactedRecord(input.artifact.snapshot ?? {}),
      ...(input.artifact.skippedActions
        ? {
            skipped_actions: input.artifact.skippedActions.map(redactText),
          }
        : {}),
    },
    date: taipeiDate(runAt),
    project: "formoria",
    routine: input.artifact.routine,
    run_at: runAt,
    source: "github_actions",
    source_run_id: routineSourceId(
      input.workflowRunId,
      input.workflowAttempt,
      input.artifact.routine,
    ),
    status,
    tickets_created: [...new Set(input.tickets ?? [])].map(redactText),
    verdict_severity: severity,
    verdict_text:
      status === "failed"
        ? `${input.artifact.routine}: collector failed`
        : findings.length === 0
          ? `${input.artifact.routine}: all clear`
          : `${input.artifact.routine}: ${findings.length} finding(s) require attention`,
    version: 1,
  };
}

export interface SlackDigestInput {
  actionableFindings?: readonly HealthFinding[];
  failures?: readonly JsonValue[];
  linearOutcomes?: readonly JsonValue[];
  prOutcomes?: readonly JsonValue[];
  skippedActions?: readonly JsonValue[];
}

export interface DeliveryDependencies {
  agentHub(envelope: HealthAgentEnvelope): Promise<unknown>;
  slack(report: SlackDigestInput): Promise<unknown>;
}

export interface LinearSyncInput {
  exhaustedAutomationFingerprints: readonly string[];
  findings: readonly HealthFinding[];
}

export interface LinearSyncResult {
  outcomes?: readonly JsonValue[];
  tickets?: readonly string[];
}

export type LinearDelivery = (
  input: LinearSyncInput,
) => Promise<LinearSyncResult>;

export interface LinearDependencies {
  sync(input: LinearSyncInput): Promise<LinearSyncResult>;
}

export interface HealthQueueFindingInput {
  evidence: JsonObject;
  fingerprint: string;
  mergePolicy: MergePolicy;
  sentryIssueId?: string;
  source: HealthSource;
  title: string;
}

export interface HealthQueueRow extends Partial<HealthFinding> {
  evidence?: JsonObject;
  fingerprint?: string;
  id?: string;
  merge_policy?: MergePolicy;
  mergePolicy?: MergePolicy;
  source?: HealthSource;
  title?: string;
}

export interface HealthAgentDatabase {
  claim?: (
    policy: MergePolicy,
    leaseOwner: string,
  ) => Promise<readonly HealthQueueRow[] | readonly RepairFinding[]>;
  claimFindings?: (
    policy: MergePolicy,
    leaseOwner: string,
  ) => Promise<readonly HealthQueueRow[] | readonly RepairFinding[]>;
  claimHealthFixes?: (
    policy: MergePolicy,
    leaseOwner: string,
  ) => Promise<readonly HealthQueueRow[] | readonly RepairFinding[]>;
  enqueue?: (input: readonly HealthQueueFindingInput[]) => Promise<unknown>;
  enqueueFindings?: (
    input: readonly HealthQueueFindingInput[],
  ) => Promise<unknown>;
  enqueueHealthFixes?: (
    input: readonly HealthQueueFindingInput[],
  ) => Promise<unknown>;
  hasUnconfirmedAutomatic?: () => Promise<boolean>;
}

export type QueueEntryInput = HealthQueueFindingInput;

export interface QueueDependencies {
  claim(
    policy: MergePolicy,
    leaseOwner: string,
  ): Promise<readonly RepairFinding[]>;
  enqueue(input: QueueEntryInput): Promise<unknown>;
  hasUnconfirmedAutomatic?: () => Promise<boolean>;
}

export interface HealthAgentDependencies {
  agentHub?: (envelope: HealthAgentEnvelope) => Promise<unknown>;
  audit?: AuditLogger;
  collectors?: CollectorDependencies;
  createPullRequest?: PullRequestCreator;
  database?: HealthAgentDatabase;
  delivery?: DeliveryDependencies;
  env?: Environment;
  fileSystem?: ArtifactFileSystem;
  files?: FileSystemLike;
  linear?: LinearDelivery | LinearDependencies;
  now?: () => Date;
  pullRequest?: PullRequestCreator;
  queue?: QueueDependencies;
  sentryCollector?: SentryCollectionProvider;
  slack?: (report: SlackDigestInput) => Promise<unknown>;
}

function resolveFiles(dependencies: HealthAgentDependencies): FileSystemLike {
  return dependencies.fileSystem ?? dependencies.files ?? defaultFileSystem;
}

function resolveDelivery(
  dependencies: HealthAgentDependencies,
): DeliveryDependencies | null {
  if (dependencies.delivery) return dependencies.delivery;
  if (dependencies.agentHub && dependencies.slack) {
    return { agentHub: dependencies.agentHub, slack: dependencies.slack };
  }
  return null;
}

function pathForRoutine(
  paths: Partial<Record<HealthRoutine, string>> & {
    directory?: string;
    link?: string;
    sentry?: string;
  },
  routine: HealthRoutine,
): string | undefined {
  return (
    paths[routine] ??
    (routine === "link-checker"
      ? paths.link
      : routine === "directory-health"
        ? paths.directory
        : paths.sentry)
  );
}

export interface AggregateInput {
  artifactPaths?: Partial<Record<HealthRoutine, string>> & {
    directory?: string;
    link?: string;
    sentry?: string;
  };
  artifacts?: Partial<Record<HealthRoutine, HealthCollectorArtifact>>;
  directoryArtifactPath?: string;
  exhaustedAutomationFingerprints?: readonly string[];
  failures?: readonly JsonValue[];
  linkArtifactPath?: string;
  linearOutcomes?: readonly JsonValue[];
  mode?: HealthAgentMode;
  prOutcomes?: readonly JsonValue[];
  runAt?: string;
  sentryArtifactPath?: string;
  skippedActions?: readonly JsonValue[];
  workflowAttempt: number;
  workflowRunId: string | number;
}

export interface DeliveryStatus {
  agentHub: "failed" | "sent";
  routine: HealthRoutine;
  slack: "failed" | "sent";
}

export interface AggregateResult {
  artifacts: Record<HealthRoutine, HealthCollectorArtifact>;
  deliveries: DeliveryStatus[];
  deliveryErrors: {
    agentHub: string[];
    slack: string[];
  };
  envelopes: HealthAgentEnvelope[];
  failures: string[];
  linearOutcomes: JsonValue[];
  skippedActions: JsonValue[];
  slackAllClear: boolean;
}

async function loadAggregateArtifacts(
  input: AggregateInput,
  dependencies: HealthAgentDependencies,
  runAt: string,
): Promise<Record<HealthRoutine, HealthCollectorArtifact>> {
  const files = resolveFiles(dependencies);
  const paths = input.artifactPaths ?? {};
  const configured: Record<HealthRoutine, string | undefined> = {
    "directory-health":
      input.directoryArtifactPath ?? pathForRoutine(paths, "directory-health"),
    "link-checker":
      input.linkArtifactPath ?? pathForRoutine(paths, "link-checker"),
    "sentry-triage":
      input.sentryArtifactPath ?? pathForRoutine(paths, "sentry-triage"),
  };
  const artifacts = {} as Record<HealthRoutine, HealthCollectorArtifact>;
  for (const routine of HEALTH_ROUTINES) {
    const supplied = input.artifacts?.[routine];
    if (supplied) {
      try {
        artifacts[routine] = normalizeCollectorArtifact(supplied, routine);
      } catch (error) {
        artifacts[routine] = failedCollectorArtifact(
          routine,
          runAt,
          `${safeErrorCode(error)}:invalid_collector_artifact`,
        );
      }
      continue;
    }
    const path = configured[routine];
    artifacts[routine] = path
      ? await loadCollectorArtifact(routine, path, runAt, files)
      : failedCollectorArtifact(routine, runAt, "missing_collector_artifact");
  }
  const link = artifacts["link-checker"];
  const directory = artifacts["directory-health"];
  if (link.status !== "success") {
    artifacts["directory-health"] = failedCollectorArtifact(
      "directory-health",
      runAt,
      "upstream_link_artifact_failed",
    );
  } else if (
    directory.status === "failed" &&
    directory.failure?.includes("missing")
  ) {
    artifacts["directory-health"] = failedCollectorArtifact(
      "directory-health",
      runAt,
      "missing_collector_artifact",
    );
  }
  return artifacts;
}

function linearFunction(
  linear: HealthAgentDependencies["linear"],
): LinearDelivery | undefined {
  if (!linear) return undefined;
  return typeof linear === "function" ? linear : (input) => linear.sync(input);
}

function uniqueFindings(findings: readonly HealthFinding[]): HealthFinding[] {
  const seen = new Set<string>();
  const result: HealthFinding[] = [];
  for (const finding of findings) {
    if (seen.has(finding.fingerprint)) continue;
    seen.add(finding.fingerprint);
    result.push(redactedFinding(finding));
  }
  return result;
}

function eligibleLinearFindings(
  findings: readonly HealthFinding[],
  exhausted: ReadonlySet<string>,
): HealthFinding[] {
  return uniqueFindings(
    findings.filter(
      (finding) =>
        requiresHumanPolicy(finding) || exhausted.has(finding.fingerprint),
    ),
  );
}

async function syncLinearIfRequired(
  findings: readonly HealthFinding[],
  exhausted: ReadonlySet<string>,
  mode: HealthAgentMode,
  dependencies: HealthAgentDependencies,
  failures: string[],
  skippedActions: JsonValue[],
): Promise<{ outcomes: JsonValue[]; tickets: string[] }> {
  const eligible = eligibleLinearFindings(findings, exhausted);
  if (eligible.length === 0) return { outcomes: [], tickets: [] };
  if (mode === "canary_fix") {
    skippedActions.push({ action: "linear", reason: "canary_fix_scope" });
    return { outcomes: [], tickets: [] };
  }
  const policy = mutationPolicy(mode, environmentValue(dependencies));
  if (!policy.business) {
    skippedActions.push({ action: "linear", reason: "mutations_disabled" });
    return { outcomes: [], tickets: [] };
  }
  const sync = linearFunction(dependencies.linear);
  if (!sync) {
    failures.push("linear:not_configured");
    return { outcomes: [], tickets: [] };
  }
  const startedAt = performance.now();
  try {
    const result = await sync({
      exhaustedAutomationFingerprints: [...exhausted],
      findings: eligible,
    });
    const outcomes = [...(result.outcomes ?? [])].map(redactForAudit);
    const tickets = [...(result.tickets ?? [])]
      .filter((ticket): ticket is string => typeof ticket === "string")
      .map(redactText);
    emitAudit(dependencies, {
      adapter: "linear",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      operation: "sync_findings",
      request: { eligible_count: eligible.length },
      response: {
        outcome_count: outcomes.length,
        ticket_count: tickets.length,
      },
      schemaValid: true,
      status: "success",
    });
    return { outcomes, tickets };
  } catch (error) {
    emitAudit(dependencies, {
      adapter: "linear",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      operation: "sync_findings",
      request: { eligible_count: eligible.length },
      response: { error: safeErrorCode(error) },
      schemaValid: false,
      status: "failure",
    });
    failures.push("linear:failed");
    return { outcomes: [], tickets: [] };
  }
}

async function deliverEnvelope(
  envelope: HealthAgentEnvelope,
  dependencies: HealthAgentDependencies,
  delivery: DeliveryDependencies | null,
): Promise<"failed" | "sent"> {
  const startedAt = performance.now();
  const hubPromise = delivery
    ? Promise.resolve().then(() => delivery.agentHub(envelope))
    : Promise.reject(new Error("agent_hub_not_configured"));
  const [hub] = await Promise.allSettled([hubPromise]);
  const hubStatus = hub.status === "fulfilled" ? "sent" : "failed";
  emitAudit(dependencies, {
    adapter: "agent-hub",
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    operation: "deliver_envelope",
    request: {
      routine: envelope.routine,
      source_run_id: envelope.source_run_id,
    },
    response:
      hub.status === "fulfilled"
        ? { delivered: true }
        : { error: safeErrorCode(hub.reason) },
    schemaValid: hub.status === "fulfilled",
    status: hubStatus === "sent" ? "success" : "failure",
  });
  return hubStatus;
}

async function deliverSlackDigest(
  report: SlackDigestInput,
  dependencies: HealthAgentDependencies,
  delivery: DeliveryDependencies | null,
): Promise<"failed" | "sent"> {
  const startedAt = performance.now();
  const slackPromise = delivery
    ? Promise.resolve().then(() => delivery.slack(report))
    : Promise.reject(new Error("slack_not_configured"));
  const [slack] = await Promise.allSettled([slackPromise]);
  const slackStatus = slack.status === "fulfilled" ? "sent" : "failed";
  emitAudit(dependencies, {
    adapter: "slack",
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    operation: "deliver_digest",
    request: { routine: "health_digest" },
    response:
      slack.status === "fulfilled"
        ? { delivered: true }
        : { error: safeErrorCode(slack.reason) },
    schemaValid: slack.status === "fulfilled",
    status: slackStatus === "sent" ? "success" : "failure",
  });
  return slackStatus;
}

export async function aggregateAndDeliver(
  input: AggregateInput,
  dependencies: HealthAgentDependencies,
  environment: Environment = environmentValue(dependencies),
): Promise<AggregateResult> {
  const runAt = validRunAt(input.runAt ?? nowFor(dependencies));
  const mode = input.mode ?? "live";
  const artifacts = await loadAggregateArtifacts(input, dependencies, runAt);
  const findings = uniqueFindings(
    HEALTH_ROUTINES.flatMap((routine) => artifacts[routine].findings),
  );
  const failureEntries: JsonValue[] = [
    ...(input.failures ?? []).map(redactForAudit),
    ...HEALTH_ROUTINES.flatMap((routine) => {
      const artifact = artifacts[routine];
      const artifactFailures =
        artifact.failures.length > 0
          ? artifact.failures
          : artifact.failure
            ? [artifact.failure]
            : [];
      return artifactFailures.map((failure) => ({
        failure: redactText(failure),
        routine,
      }));
    }),
  ];
  const skippedEntries: JsonValue[] = [
    ...(input.skippedActions ?? []).map(redactForAudit),
    ...HEALTH_ROUTINES.flatMap((routine) =>
      artifacts[routine].skippedActions.map((action) => ({
        action: redactText(action),
        routine,
      })),
    ),
  ];
  const failures = failureEntries.map((value) => JSON.stringify(value));
  const skippedActions = skippedEntries;
  const exhausted = new Set(input.exhaustedAutomationFingerprints ?? []);
  const linear = await syncLinearIfRequired(
    findings,
    exhausted,
    mode,
    { ...dependencies, env: environment },
    failures,
    skippedActions,
  );
  const linearOutcomes = [
    ...(input.linearOutcomes ?? []).map(redactForAudit),
    ...linear.outcomes,
  ];
  const slackFailureEntries: JsonValue[] = [
    ...failureEntries,
    ...failures.slice(failureEntries.length).map((failure) => ({
      failure: redactText(failure),
      routine: "orchestrator",
    })),
  ];
  const envelopes = HEALTH_ROUTINES.map((routine) =>
    createRoutineEnvelope({
      artifact: artifacts[routine],
      runAt,
      tickets: linear.tickets,
      workflowAttempt: input.workflowAttempt,
      workflowRunId: input.workflowRunId,
    }),
  );
  const delivery = resolveDelivery(dependencies);
  const slackReport: SlackDigestInput = {
    actionableFindings: findings.map(redactedFinding),
    failures: slackFailureEntries.map(redactForAudit),
    linearOutcomes: linearOutcomes.map(redactForAudit),
    prOutcomes: (input.prOutcomes ?? []).map(redactForAudit),
    skippedActions: skippedActions.map(redactForAudit),
  };
  const envelopesByRoutine = new Map(
    envelopes.map((envelope) => [envelope.routine, envelope] as const),
  );
  const agentHubStatuses = await Promise.all(
    HEALTH_ROUTINES.map(async (routine) => {
      const envelope = envelopesByRoutine.get(routine);
      if (!envelope) throw new Error(`Missing ${routine} envelope`);
      return deliverEnvelope(envelope, dependencies, delivery);
    }),
  );
  const slackStatus = await deliverSlackDigest(
    slackReport,
    dependencies,
    delivery,
  );
  const deliveries = HEALTH_ROUTINES.map((routine, index): DeliveryStatus => ({
    agentHub: agentHubStatuses[index] ?? "failed",
    routine,
    slack: slackStatus,
  }));
  const deliveryErrors = {
    agentHub: deliveries
      .filter(({ agentHub }) => agentHub === "failed")
      .map(({ routine }) => routine),
    slack: slackStatus === "failed" ? ["health-digest"] : [],
  };
  const allFailures = [
    ...failures,
    ...deliveryErrors.agentHub.map((routine) => `agent_hub:${routine}`),
    ...deliveryErrors.slack.map((routine) => `slack:${routine}`),
  ];
  return {
    artifacts,
    deliveries,
    deliveryErrors,
    envelopes,
    failures: allFailures,
    linearOutcomes,
    skippedActions,
    slackAllClear:
      findings.length === 0 &&
      allFailures.length === 0 &&
      skippedActions.length === 0 &&
      linearOutcomes.length === 0 &&
      (input.prOutcomes?.length ?? 0) === 0,
  };
}

function asRepairFinding(value: HealthQueueRow | RepairFinding): RepairFinding {
  const candidate = value as HealthQueueRow;
  const fingerprint =
    stringValue(candidate.fingerprint) ??
    (isRecord(candidate) && isRecord(candidate.finding)
      ? stringValue(candidate.finding.fingerprint)
      : undefined);
  const evidence =
    candidate.evidence ??
    (isRecord(candidate) && isRecord(candidate.finding)
      ? redactedRecord(candidate.finding.evidence)
      : {});
  const source =
    candidate.source ??
    (isRecord(candidate) && isRecord(candidate.finding)
      ? (candidate.finding.source as HealthSource)
      : undefined);
  const title =
    candidate.title ??
    (isRecord(candidate) && isRecord(candidate.finding)
      ? stringValue(candidate.finding.title)
      : undefined);
  const mergePolicy =
    candidate.mergePolicy ??
    candidate.merge_policy ??
    (isRecord(candidate) && isRecord(candidate.finding)
      ? (candidate.finding.mergePolicy as MergePolicy)
      : undefined);
  if (!fingerprint || !source || !title || !mergePolicy) {
    throw new Error("Claimed finding is invalid");
  }
  const severity = candidate.severity ?? "medium";
  return {
    ...(candidate.id ? { claimedFindingId: candidate.id } : {}),
    evidence: redactedRecord(evidence),
    fingerprint: redactText(fingerprint),
    mergePolicy,
    severity,
    source,
    title: redactText(title),
    ...(candidate.humanReason
      ? { humanReason: redactText(candidate.humanReason) }
      : {}),
    ...(candidate.sentryIssueId
      ? { sentryIssueId: redactText(candidate.sentryIssueId) }
      : {}),
  } as RepairFinding;
}

function emptyPartition(): RepairPartition {
  const snapshot = snapshotClaimedFindings([]);
  return partitionRepairBatch(snapshot);
}

function policyBatch(
  snapshot: RepairSnapshot,
  kind: "automatic" | "human",
): RepairBatch {
  const raw = partitionRepairBatch(snapshot);
  const base = raw[kind];
  const policies = snapshot.findings.map((finding) => {
    const existing = base.findingPolicies.find(
      ({ fingerprint }) => fingerprint === finding.fingerprint,
    );
    return {
      automaticEligible:
        kind === "automatic" && (existing?.automaticEligible ?? true),
      effectiveMergePolicy: kind,
      fingerprint: finding.fingerprint,
      reasons: existing?.reasons ?? [],
      requestedMergePolicy: finding.mergePolicy,
      rootCauseKey: existing?.rootCauseKey ?? finding.fingerprint,
    };
  });
  return {
    ...base,
    clusters: clusterRepairFindings(snapshot),
    findingPolicies: policies,
    findings: [...snapshot.findings],
    mergePolicy: kind,
    snapshotId: snapshot.snapshotId,
  };
}

function claimedPartition(
  automaticFindings: readonly RepairFinding[],
  humanFindings: readonly RepairFinding[],
): {
  automatic: RepairSnapshot;
  human: RepairSnapshot;
  partition: RepairPartition;
  snapshot: RepairSnapshot;
} {
  const automatic = snapshotClaimedFindings(automaticFindings);
  const human = snapshotClaimedFindings(humanFindings);
  const snapshot = snapshotClaimedFindings([
    ...automatic.findings,
    ...human.findings,
  ]);
  return {
    automatic,
    human,
    partition: {
      automatic: policyBatch(automatic, "automatic"),
      human: policyBatch(human, "human"),
      snapshot,
    },
    snapshot,
  };
}

export interface QueueBatchInput {
  canaryFingerprints?: readonly string[];
  exhaustedAutomationFingerprints?: readonly string[];
  findings: readonly HealthFinding[];
  leaseOwner?: string;
  mode: HealthAgentMode;
  repairResults?: readonly RepairResult[];
}

export interface QueueBatchResult {
  automatic: RepairSnapshot;
  claimedFingerprints: string[];
  enqueuedFingerprints: string[];
  failures: string[];
  human: RepairSnapshot;
  linear: {
    outcomes: JsonValue[];
    status: "failed" | "not_required" | "sent" | "suppressed";
  };
  partition: RepairPartition;
  skippedActions: string[];
  snapshot: RepairSnapshot;
  suppressed: boolean;
}

export const HEALTH_AGENT_CANARY_FINGERPRINT =
  "directory:canary:github-app-pr" as const;

function canaryFinding(leaseOwner: string): HealthFinding {
  return {
    evidence: {
      behaviorChangeRisk: "low",
      canary: true,
      changedFiles: ["health-agent-canary.txt"],
      confidence: 1,
      defectKind: "application",
      desiredMarker: leaseOwner,
      evidenceArtifactRef: "github-actions:health-agent-canary",
      fixability: "high",
      reproducible: true,
      rootCause: "Refresh the harmless health-agent canary marker.",
      rootCauseKey: "github-app-canary",
      sensitivePaths: [],
    },
    fingerprint: HEALTH_AGENT_CANARY_FINGERPRINT,
    mergePolicy: "automatic",
    severity: "low",
    source: "directory",
    title: "Refresh the GitHub App health-agent canary marker",
  };
}

function harmlessCanary(finding: HealthFinding): boolean {
  return (
    finding.source === "directory" &&
    finding.mergePolicy === "automatic" &&
    finding.severity === "low" &&
    finding.fingerprint === HEALTH_AGENT_CANARY_FINGERPRINT &&
    finding.evidence.canary === true
  );
}

function queueInput(finding: HealthFinding): HealthQueueFindingInput {
  if (!SAFE_IDENTITY.test(finding.fingerprint)) {
    throw new Error("Finding fingerprint is invalid");
  }
  return {
    evidence: redactedRecord(finding.evidence),
    fingerprint: finding.fingerprint,
    mergePolicy: finding.mergePolicy,
    ...(finding.sentryIssueId
      ? { sentryIssueId: redactText(finding.sentryIssueId) }
      : {}),
    source: finding.source,
    title: redactText(finding.title),
  };
}

function claimedRows(
  rows: readonly HealthQueueRow[] | readonly RepairFinding[],
): RepairFinding[] {
  return rows.map((row) => asRepairFinding(row));
}

function exhaustedFingerprints(input: QueueBatchInput): Set<string> {
  const exhausted = new Set(input.exhaustedAutomationFingerprints ?? []);
  for (const result of input.repairResults ?? []) {
    if (
      result.batchKind === "automatic" &&
      (result.status === "needs_human" ||
        (result.cycles.length >= 2 && !result.fixed))
    ) {
      for (const resultFinding of result.findings) {
        exhausted.add(resultFinding.fingerprint);
      }
    }
  }
  return exhausted;
}

function databaseEnqueue(
  database: HealthAgentDatabase,
):
  | ((input: readonly HealthQueueFindingInput[]) => Promise<unknown>)
  | undefined {
  return (
    database.enqueueFindings ?? database.enqueueHealthFixes ?? database.enqueue
  );
}

function databaseClaim(
  database: HealthAgentDatabase,
):
  | ((
      policy: MergePolicy,
      leaseOwner: string,
    ) => Promise<readonly HealthQueueRow[] | readonly RepairFinding[]>)
  | undefined {
  return database.claimFindings ?? database.claimHealthFixes ?? database.claim;
}

export async function enqueueAndClaimPolicyBatches(
  input: QueueBatchInput,
  dependencies: HealthAgentDependencies,
  environment: Environment = environmentValue(dependencies),
): Promise<QueueBatchResult> {
  const skippedActions: string[] = [];
  const failures: string[] = [];
  const empty = emptyPartition();
  const baseResult = (
    suppressed: boolean,
    snapshot = empty.snapshot,
    partition = empty,
    enqueuedFingerprints: string[] = [],
    claimedFingerprints: string[] = [],
  ): QueueBatchResult => ({
    automatic: snapshotClaimedFindings(partition.automatic.findings),
    claimedFingerprints,
    enqueuedFingerprints,
    failures,
    human: snapshotClaimedFindings(partition.human.findings),
    linear: { outcomes: [], status: "not_required" },
    partition,
    skippedActions,
    snapshot,
    suppressed,
  });

  if (input.mode === "preflight") {
    skippedActions.push(
      "linear",
      "enqueue",
      "claim",
      "cleanup",
      "pull_request",
      "business_mutation",
    );
    return baseResult(true);
  }

  const policy = mutationPolicy(input.mode, environment);
  if (!policy.business) {
    skippedActions.push("enqueue", "claim", "linear", "business_mutation");
    return baseResult(true);
  }

  const requestedCanary = new Set(input.canaryFingerprints ?? []);
  const candidates =
    input.mode === "canary_fix" &&
    requestedCanary.has(HEALTH_AGENT_CANARY_FINGERPRINT)
      ? [
          ...input.findings,
          canaryFinding(input.leaseOwner ?? "github-actions-health-agent"),
        ]
      : input.findings;
  const eligible = uniqueFindings(
    candidates.filter((finding) => {
      if (input.mode !== "canary_fix") return true;
      const allowed =
        requestedCanary.has(finding.fingerprint) && harmlessCanary(finding);
      if (!allowed) skippedActions.push(`canary:${finding.fingerprint}`);
      return allowed;
    }),
  );
  if (input.mode === "canary_fix" && eligible.length === 0) {
    skippedActions.push("canary_fix");
    return baseResult(true);
  }

  const enqueueInput = eligible.map(queueInput);
  const database = dependencies.database;
  const legacyQueue =
    dependencies.queue ??
    ("claim" in dependencies && "enqueue" in dependencies
      ? (dependencies as unknown as QueueDependencies)
      : undefined);
  try {
    if (database) {
      const enqueue = databaseEnqueue(database);
      if (!enqueue) throw new Error("Queue enqueue is unavailable");
      await enqueue(enqueueInput);
    } else {
      if (!legacyQueue) throw new Error("Queue adapter is unavailable");
      await Promise.all(
        enqueueInput.map((entry) => legacyQueue.enqueue(entry)),
      );
    }
  } catch (error) {
    failures.push(`enqueue:${safeErrorCode(error)}`);
    return baseResult(false, empty.snapshot, empty, [], []);
  }

  const leaseOwner = input.leaseOwner ?? "github-actions-health-agent";
  let automaticClaimed: RepairFinding[] = [];
  let humanClaimed: RepairFinding[] = [];
  try {
    if (database) {
      const claim = databaseClaim(database);
      if (!claim) throw new Error("Queue claim is unavailable");
      automaticClaimed = claimedRows(await claim("automatic", leaseOwner));
      if (automaticClaimed.length === 0) {
        const unconfirmed = database.hasUnconfirmedAutomatic
          ? await database.hasUnconfirmedAutomatic()
          : true;
        if (!unconfirmed) {
          humanClaimed = claimedRows(await claim("human", leaseOwner));
        }
      }
    } else {
      if (!legacyQueue) throw new Error("Queue adapter is unavailable");
      automaticClaimed = [
        ...(await legacyQueue.claim("automatic", leaseOwner)),
      ];
      if (automaticClaimed.length === 0) {
        const unconfirmed = legacyQueue.hasUnconfirmedAutomatic
          ? await legacyQueue.hasUnconfirmedAutomatic()
          : true;
        if (!unconfirmed) {
          humanClaimed = [...(await legacyQueue.claim("human", leaseOwner))];
        }
      }
    }
  } catch (error) {
    failures.push(`claim:${safeErrorCode(error)}`);
    return baseResult(
      false,
      empty.snapshot,
      empty,
      eligible.map(({ fingerprint }) => fingerprint),
      [],
    );
  }

  const claimedResult = claimedPartition(automaticClaimed, humanClaimed);
  const claimedUnique = uniqueFindings([...automaticClaimed, ...humanClaimed]);
  const snapshot = claimedResult.snapshot;
  const partition = claimedResult.partition;
  const exhausted = exhaustedFingerprints(input);
  const linearEligible = eligibleLinearFindings(eligible, exhausted);
  let linearResult: QueueBatchResult["linear"] = {
    outcomes: [],
    status: "not_required",
  };
  if (linearEligible.length > 0) {
    const sync = linearFunction(dependencies.linear);
    if (!policy.business) {
      skippedActions.push("linear");
      linearResult = { outcomes: [], status: "suppressed" };
    } else if (!sync) {
      failures.push("linear:not_configured");
      linearResult = { outcomes: [], status: "failed" };
    } else {
      try {
        const result = await sync({
          exhaustedAutomationFingerprints: [...exhausted],
          findings: linearEligible,
        });
        linearResult = {
          outcomes: [...(result.outcomes ?? [])].map(redactForAudit),
          status: "sent",
        };
      } catch (error) {
        failures.push(`linear:${safeErrorCode(error)}`);
        linearResult = { outcomes: [], status: "failed" };
      }
    }
  }
  return {
    automatic: claimedResult.automatic,
    claimedFingerprints: claimedUnique.map(({ fingerprint }) => fingerprint),
    enqueuedFingerprints: eligible.map(({ fingerprint }) => fingerprint),
    failures,
    human: claimedResult.human,
    linear: linearResult,
    partition,
    skippedActions,
    snapshot,
    suppressed: false,
  };
}

export async function enqueueAndClaimBatch(
  input: QueueBatchInput,
  queue: QueueDependencies,
  environment: Environment = process.env,
): Promise<QueueBatchResult> {
  return enqueueAndClaimPolicyBatches(input, { queue }, environment);
}

export interface PullRequestOutcome {
  number?: number;
  reason?: string;
  status: "failed" | "opened" | "skipped";
}

export type PullRequestCreator = (
  batch: RepairBatch,
) => Promise<{ number?: number }>;

export async function createRepairPullRequest(
  input: {
    batch: RepairBatch;
    canaryFingerprints?: readonly string[];
    mode: HealthAgentMode;
  },
  dependencies: HealthAgentDependencies,
  environment: Environment = environmentValue(dependencies),
): Promise<PullRequestOutcome> {
  if (input.mode === "preflight") {
    return { reason: "preflight", status: "skipped" };
  }
  const policy = mutationPolicy(input.mode, environment);
  if (!policy.business || !policy.autofix) {
    return { reason: "autofix_disabled", status: "skipped" };
  }
  if (
    input.mode === "canary_fix" &&
    !input.batch.findings.every(
      (finding) =>
        (input.canaryFingerprints ?? []).includes(finding.fingerprint) &&
        harmlessCanary(finding),
    )
  ) {
    return { reason: "canary_fingerprint_not_harmless", status: "skipped" };
  }
  const creator = dependencies.createPullRequest ?? dependencies.pullRequest;
  if (!creator)
    return { reason: "pull_request_not_configured", status: "failed" };
  try {
    const result = await creator(input.batch);
    return {
      ...(numberValue(result.number) ? { number: result.number } : {}),
      status: "opened",
    };
  } catch {
    return { reason: "pull_request_failed", status: "failed" };
  }
}

export interface PrResultEnvelopeInput {
  mergePolicy?: MergePolicy;
  mode?: HealthAgentMode;
  prNumber?: number;
  prUrl?: string;
  result?: RepairResult | Record<string, unknown>;
  runAt?: string;
  snapshotId?: string;
  status?: "awaiting_human" | "failed" | "merged" | "opened";
  workflowAttempt: number;
  workflowRunId: string | number;
}

function prStatus(value: unknown): "failed" | "skipped" | "success" {
  if (value === "preflight" || value === "skipped") return "skipped";
  return value === "awaiting_human" ||
    value === "failed" ||
    value === "needs_human" ||
    value === "retry_required"
    ? "failed"
    : "success";
}

function prFindingTrace(value: unknown): JsonValue[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_FINDINGS).flatMap((finding) => {
    if (!isRecord(finding)) return [];
    const fingerprint = stringValue(finding.fingerprint);
    const source = stringValue(finding.source);
    if (!fingerprint || !source) return [];
    return [
      {
        ...(finding.changedFiles
          ? {
              changed_files:
                redactedRecord({ value: finding.changedFiles }).value ?? [],
            }
          : {}),
        fingerprint: redactText(fingerprint),
        source: redactText(source),
        status: redactText(String(finding.status ?? "unknown")),
      },
    ];
  });
}

export function buildPrResultEnvelope(
  input: PrResultEnvelopeInput,
): HealthAgentEnvelope {
  const runAt = validRunAt(input.runAt);
  const result = isRecord(input.result) ? input.result : {};
  const statusValue =
    input.mode === "preflight" ? "skipped" : (result.status ?? input.status);
  const status = prStatus(statusValue);
  const mergePolicy =
    result.mergePolicy === "human" || input.mergePolicy === "human"
      ? "human"
      : "automatic";
  const snapshotId =
    stringValue(result.snapshotId) ?? input.snapshotId ?? "unknown";
  const prNumber = numberValue(result.prNumber) ?? input.prNumber ?? null;
  const findings = prFindingTrace(result.findings);
  const linearRequired =
    result.linearRequired === true || mergePolicy === "human";
  const tickets = Array.isArray(result.tickets)
    ? result.tickets.filter(
        (ticket): ticket is string => typeof ticket === "string",
      )
    : [];
  return {
    data: {
      auto_merge_eligible: result.autoMergeEligible === true,
      auto_merge_enabled: result.autoMergeEnabled === true,
      batch_kind: mergePolicy,
      finding_count: findings.length,
      findings,
      fixed: result.fixed === true,
      linear_required: linearRequired,
      merge_policy: mergePolicy,
      merged: result.merged === true,
      notification_owner: "github_actions",
      pr_number: prNumber,
      snapshot_id: redactText(snapshotId),
      status:
        statusValue === undefined ? "unknown" : redactText(String(statusValue)),
    },
    date: taipeiDate(runAt),
    project: "formoria",
    routine: "health-selfheal",
    run_at: runAt,
    source: "github_actions",
    source_run_id: routineSourceId(
      input.workflowRunId,
      input.workflowAttempt,
      "health-selfheal",
    ),
    status,
    tickets_created: tickets.map(redactText),
    verdict_severity:
      status === "failed" ? "error" : status === "skipped" ? "info" : "warning",
    verdict_text: `Health repair result: ${status}`,
    version: 1,
  };
}

export function createPrResultEnvelope(
  input: PrResultEnvelopeInput,
): HealthAgentEnvelope {
  return buildPrResultEnvelope(input);
}

export interface RunCommandInput extends AggregateInput {
  canaryFingerprints?: readonly string[];
  classifier?: SentryClassifier;
  command: HealthAgentCommandAlias;
  directoryCollector?: DirectoryCollectionProvider;
  findings?: readonly HealthFinding[];
  leaseOwner?: string;
  options?: Omit<SentryFindingsOptions, "classifier">;
  outputPath?: string;
}

function canonicalCommand(
  command: HealthAgentCommandAlias,
): HealthAgentCommand {
  switch (command) {
    case "construct-link-request":
      return "link-request";
    case "collect-sentry-artifact":
      return "sentry-collect";
    case "collect-directory-artifact":
      return "directory-collect";
    case "enqueue-claim-policy-batches":
      return "enqueue-claim-batch";
    case "pr-result":
      return "pr-result-envelope";
    default:
      return command;
  }
}

export async function runCommand(
  command: HealthAgentCommandAlias,
  input: RunCommandInput | Record<string, unknown>,
  dependencies: HealthAgentDependencies,
): Promise<unknown> {
  const value = input as RunCommandInput;
  switch (canonicalCommand(command)) {
    case "link-request":
      return buildLinkHealthRequest(value);
    case "sentry-collect":
      return collectSentryArtifact(
        {
          classifier: value.classifier,
          mode: value.mode,
          options: value.options,
          outputPath: value.outputPath ?? "sentry-triage.json",
          runAt: value.runAt,
        },
        dependencies,
      );
    case "directory-collect":
      return collectDirectoryArtifact(
        {
          collector: value.directoryCollector,
          linkArtifactPath: value.linkArtifactPath,
          mode: value.mode,
          outputPath: value.outputPath ?? "directory-health.json",
          runAt: value.runAt,
        },
        dependencies,
      );
    case "aggregate-and-deliver":
      return aggregateAndDeliver(value, dependencies);
    case "enqueue-claim-batch":
      return enqueueAndClaimPolicyBatches(
        {
          canaryFingerprints: value.canaryFingerprints,
          findings: value.findings ?? [],
          leaseOwner: value.leaseOwner,
          mode: value.mode ?? "live",
        },
        dependencies,
      );
    case "pr-result-envelope":
      return buildPrResultEnvelope(value);
  }
}

export const runHealthAgent = runCommand;
export const executeHealthCommand = runCommand;

function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  const next = index >= 0 ? argv[index + 1] : undefined;
  return next;
}

function requiredArgument(argv: readonly string[], name: string): string {
  const value = argument(argv, name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function parseMode(argv: readonly string[]): HealthAgentMode {
  const value = requiredArgument(argv, "--mode");
  if (!HEALTH_AGENT_MODES.includes(value as HealthAgentMode)) {
    throw new Error("Invalid mode");
  }
  return value as HealthAgentMode;
}

export async function main(
  argv = process.argv.slice(2),
  dependencies: HealthAgentDependencies = {},
): Promise<void> {
  const commandValue = argv.at(0);
  if (!commandValue) throw new Error("A health agent command is required");
  const command = commandValue as HealthAgentCommandAlias;
  const files = resolveFiles(dependencies);
  if (canonicalCommand(command) === "link-request") {
    const request = buildLinkHealthRequest({
      endpoint: process.env.FORMORIA_LINK_HEALTH_URL,
      mode: parseMode(argv),
      railwayUrl: process.env.FORMORIA_RAILWAY_URL,
      runIdentity: process.env.HEALTH_RUN_IDENTITY,
      workflowAttempt: Number(requiredArgument(argv, "--attempt")),
      workflowRunId: requiredArgument(argv, "--run-id"),
    });
    await writeRedactedJson(requiredArgument(argv, "--output"), request, files);
    return;
  }
  if (canonicalCommand(command) === "sentry-collect") {
    await collectSentryArtifact(
      {
        mode: parseMode(argv),
        outputPath: requiredArgument(argv, "--output"),
        runAt: argument(argv, "--run-at"),
      },
      dependencies,
    );
    return;
  }
  if (canonicalCommand(command) === "directory-collect") {
    await collectDirectoryArtifact(
      {
        linkArtifactPath: requiredArgument(argv, "--link-artifact"),
        mode: parseMode(argv),
        outputPath: requiredArgument(argv, "--output"),
        runAt: requiredArgument(argv, "--run-at"),
      },
      dependencies,
    );
    return;
  }
  if (canonicalCommand(command) === "aggregate-and-deliver") {
    const result = await aggregateAndDeliver(
      {
        artifactPaths: {
          "directory-health": requiredArgument(argv, "--directory-artifact"),
          "link-checker": requiredArgument(argv, "--link-artifact"),
          "sentry-triage": requiredArgument(argv, "--sentry-artifact"),
        },
        mode: parseMode(argv),
        runAt: requiredArgument(argv, "--run-at"),
        workflowAttempt: Number(requiredArgument(argv, "--attempt")),
        workflowRunId: requiredArgument(argv, "--run-id"),
      },
      dependencies,
    );
    await writeRedactedJson(requiredArgument(argv, "--output"), result, files);
    if (result.failures.length > 0) throw new Error("Health delivery failed");
    return;
  }
  if (canonicalCommand(command) === "enqueue-claim-batch") {
    const artifact = normalizeCollectorArtifact(
      await readBoundedJson(
        requiredArgument(argv, "--findings-artifact"),
        files,
      ),
    );
    const result = await enqueueAndClaimPolicyBatches(
      {
        canaryFingerprints: (argument(argv, "--canary-fingerprints") ?? "")
          .split(",")
          .filter(Boolean),
        findings: artifact.findings,
        leaseOwner: requiredArgument(argv, "--lease-owner"),
        mode: parseMode(argv),
      },
      dependencies,
    );
    await writeRedactedJson(requiredArgument(argv, "--output"), result, files);
    return;
  }
  const value = await readBoundedJson(requiredArgument(argv, "--input"), files);
  if (!isRecord(value)) throw new Error("Invalid PR result");
  const result = buildPrResultEnvelope({
    ...value,
    runAt: value.runAt ?? value.run_at,
    workflowAttempt: Number(value.workflowAttempt ?? value.workflow_attempt),
    workflowRunId: String(value.workflowRunId ?? value.workflow_run_id),
  } as PrResultEnvelopeInput);
  await writeRedactedJson(requiredArgument(argv, "--output"), result, files);
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  main().catch(() => {
    console.error("Health agent command failed");
    process.exitCode = 1;
  });
}
