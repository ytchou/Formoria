import { z } from "zod";
import {
  type AuditLogger,
  type HealthFinding,
  type HealthSeverity,
  type JsonValue,
  type MergePolicy,
  stableFingerprint,
} from "./contracts";

const MAX_ANALYZED_ISSUES = 20;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 3;
const DEFAULT_MAX_REQUESTS = 3;
const MAX_PAGE_SIZE = 20;
const MAX_PAGES = 5;
const MAX_REQUESTS = 5;
const MAX_CLASSIFIER_OUTPUT = 20_000;
const HIGH_CONFIDENCE = 0.8;

const HEALTH_SEVERITY_VALUES = ["low", "medium", "high", "critical"] as const;
const MERGE_POLICY_VALUES = ["automatic", "human"] as const;

const recurrenceSchema = z
  .object({
    status: z.enum(["new", "recurring"]),
    count: z.number().int().min(0).max(1_000_000),
    evidence: z.string().min(1).max(400),
  })
  .strict();

export const SentryClassificationSchema = z
  .object({
    severity: z.enum(HEALTH_SEVERITY_VALUES),
    rootCause: z.string().min(1).max(500),
    confidence: z.number().min(0).max(1),
    recurrence: recurrenceSchema,
    reproducible: z.boolean(),
    fixability: z.enum(["low", "medium", "high", "unknown"]),
    behaviorChangeRisk: z.enum(["low", "medium", "high", "unknown"]),
    sensitivePaths: z.array(z.string().min(1).max(200)).max(20),
    changedFiles: z.array(z.string().min(1).max(200)).max(20).optional(),
    rootCauseKey: z.string().min(1).max(200).optional(),
    defectKind: z.enum(["application", "dependency", "unknown"]).optional(),
    dependencyImpact: z.enum(["patch", "minor", "major", "unknown"]).optional(),
    recommendedAction: z.string().min(1).max(500),
    mergePolicy: z.enum(MERGE_POLICY_VALUES),
  })
  .strict();

export type SentryClassification = z.infer<typeof SentryClassificationSchema>;

export interface SentryRecurrenceEvidence {
  eventCount: number;
  userCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface SentryRootCauseEvidence {
  culprit: string | null;
  exceptionType: string | null;
  message: string | null;
  stack: string[];
  platform: string | null;
  level: string | null;
  tags: Record<string, string>;
}

export interface SanitizedSentryIssue {
  title: string;
  environment: "production";
  rootCauseEvidence: SentryRootCauseEvidence;
  recurrence: SentryRecurrenceEvidence;
}

export interface SentryClassifierPayload {
  filename: "sentry-issue.json";
  mediaType: "application/json";
  value: SanitizedSentryIssue;
}

export type SentryClassifier = (
  payload: SentryClassifierPayload,
) => unknown | Promise<unknown>;

export interface SentryCollectorOptions {
  baseUrl?: string;
  apiBaseUrl?: string;
  organization?: string;
  organizationSlug?: string;
  org?: string;
  project?: string;
  projectSlug?: string;
  token?: string;
  readToken?: string;
  fetchImpl?: typeof fetch;
  fetchImplementation?: typeof fetch;
  audit?: AuditLogger;
  pageSize?: number;
  maxPages?: number;
  maxRequests?: number;
  timeoutMs?: number;
}

export interface SentryFindingsOptions extends SentryCollectorOptions {
  classifier: SentryClassifier;
  incidentMode?: boolean;
}

export interface SentryIssueCollection {
  issues: SanitizedSentryIssue[];
  incidentMode: boolean;
  hasMore: boolean;
  requestCount: number;
  candidateIssueCount: number;
}

export interface SentryCollectionResult extends SentryIssueCollection {
  findings: HealthFinding[];
  analyzedIssueCount: number;
}

type UnknownRecord = Record<string, unknown>;

interface SentryIssueCandidate {
  issue: SanitizedSentryIssue;
  issueId?: string;
}

interface CollectorConfig {
  baseUrl: string;
  organization: string;
  project: string;
  token: string;
  fetchImpl: typeof fetch;
  audit: AuditLogger;
  pageSize: number;
  maxPages: number;
  maxRequests: number;
  timeoutMs: number;
}

interface SentryPage {
  issues: UnknownRecord[];
  nextCursor: string | null;
  hasNext: boolean;
  total: number | null;
}

export type SentryCollectorErrorCode =
  "invalid_configuration" | "request_failed" | "invalid_provider_response";

export class SentryCollectorError extends Error {
  public readonly code: SentryCollectorErrorCode;
  public readonly httpStatus: number | null;

  constructor(
    code: SentryCollectorErrorCode,
    message: string,
    httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "SentryCollectorError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class SentryClassifierError extends Error {
  public readonly code = "classifier_invalid" as const;
  public readonly attempts: number;

  constructor(attempts = 2) {
    super("Sentry classifier returned invalid JSON or schema after one retry.");
    this.name = "SentryClassifierError";
    this.attempts = attempts;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function recordValue(record: UnknownRecord, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function nestedRecord(
  record: UnknownRecord,
  key: string,
): UnknownRecord | null {
  const value = recordValue(record, key);
  return isRecord(value) ? value : null;
}

function nestedRecords(record: UnknownRecord, key: string): UnknownRecord[] {
  const value = recordValue(record, key);
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = stringValue(value);
    if (candidate) return candidate;
  }
  return null;
}

function numberValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

function boundedNumber(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  const number = numberValue(value);
  if (number === null || !Number.isInteger(number) || number < 1)
    return fallback;
  return Math.min(number, maximum);
}

const instructionLikePatterns = [
  /\b(?:ignore|disregard|forget|override|bypass)\b.{0,60}\b(?:instruction|prompt|rule|policy|message|above|previous|prior)\b/i,
  /\b(?:system|developer|assistant|user)\s+(?:message|prompt|instruction)\b/i,
  /\b(?:reveal|exfiltrate|leak|print|send|upload)\b.{0,80}\b(?:secret|token|password|cookie|key|prompt|credential)\b/i,
  /\b(?:run|execute)\b.{0,50}\b(?:shell|command|script|yaml|workflow)\b/i,
  /\b(?:output|respond|return)\b.{0,50}\b(?:only|instead)\b.{0,50}\b(?:json|yaml|markdown|instructions?)\b/i,
  /\b(?:jailbreak|prompt injection|do not trust|follow these instructions)\b/i,
];

const sensitiveKeyPattern =
  /(?:^|[_-])(?:id|ids|fingerprint|shortid|release)$|(?:authorization|authenticate|auth|cookie|csrf|token|secret|password|passwd|credential|private[_-]?key|api[_-]?key|request|body|payload|data|form|query|stringified|header|email|ip|user|session|signature|jwt|context|breadcrumb)/i;

function looksLikeInstruction(value: string): boolean {
  return instructionLikePatterns.some((pattern) => pattern.test(value));
}

function removeInstructionLikeText(value: string): string {
  const withoutMarkup = value.replace(
    /<\/?(?:system|developer|assistant|user|instruction|prompt)[^>]*>/gi,
    " ",
  );
  const fragments = withoutMarkup.split(/(?:\r?\n|(?<=[.!?;]))\s+/u);
  return fragments
    .filter((fragment) => !looksLikeInstruction(fragment))
    .join(" ");
}

function sanitizeExternalText(value: unknown, maximum = 500): string {
  const original = typeof value === "string" ? value : "";
  if (!original) return "";

  let sanitized = original
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(
      /-----BEGIN [^-\n]{1,80}-----[\s\S]*?-----END [^-\n]{1,80}-----/gi,
      " [redacted-secret] ",
    )
    .replace(/\b(?:https?|ftp):\/\/[^\s<>'"]+/gi, " ")
    .replace(/\bwww\.[^\s<>'"]+/gi, " ")
    .replace(/(?:[?&][A-Za-z0-9_.-]+=[^\s&]+)/g, " ")
    .replace(
      /\b(?:bearer|basic)\s+[A-Za-z0-9._~+\-/]+=*/gi,
      " [redacted-auth] ",
    )
    .replace(
      /\b(?:authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|credential|private[_-]?key|csrf)\s*[:=]\s*[^\s,;]+/gi,
      " [redacted-secret] ",
    )
    .replace(
      /\b(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+\b/g,
      " [redacted-token] ",
    )
    .replace(
      /\b(?:sk|pk|ghp|gho|github_pat|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/gi,
      " [redacted-token] ",
    )
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, " [redacted-token] ")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, " [identifier] ")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      " [identifier] ",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " [identifier] ")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, " [identifier] ")
    .replace(
      /\b(?:user|account|org|project|issue|event|trace|request|session)[ _-]?(?:id)?\s*[:=]\s*[^\s,;]+/gi,
      " [identifier] ",
    );

  sanitized = removeInstructionLikeText(sanitized).replace(/\s+/g, " ").trim();

  return sanitized.slice(0, maximum).trim();
}

export function sanitizeExternalValue(
  value: unknown,
  key = "",
  depth = 0,
): JsonValue | undefined {
  if (sensitiveKeyPattern.test(key)) return undefined;
  if (depth > 3) return undefined;

  if (typeof value === "string") {
    const sanitized = sanitizeExternalText(value);
    return sanitized || undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, 12)
      .map((item) => sanitizeExternalValue(item, key, depth + 1))
      .filter((item): item is JsonValue => item !== undefined);
    return sanitized;
  }
  if (!isRecord(value)) return undefined;

  const result: Record<string, JsonValue> = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 24)) {
    const safeKey = childKey
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "_")
      .slice(0, 80);
    if (!safeKey || looksLikeInstruction(childKey)) continue;
    const sanitized = sanitizeExternalValue(childValue, safeKey, depth + 1);
    if (sanitized !== undefined) result[safeKey] = sanitized;
  }
  return result;
}

function sanitizePath(value: unknown): string | null {
  const sanitized = sanitizeExternalText(value, 240)
    .replace(/\\/g, "/")
    .replace(/^file:\/\//i, "")
    .trim();
  if (!sanitized) return null;

  const repoMarkers = [
    "src/",
    "app/",
    "components/",
    "scripts/",
    "lib/",
    "pages/",
    "tests/",
    "test/",
  ];
  const lower = sanitized.toLowerCase();
  const markerIndex = repoMarkers
    .map((marker) => lower.lastIndexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (markerIndex !== undefined) return sanitized.slice(markerIndex);

  const segments = sanitized.split("/").filter(Boolean);
  return segments.slice(-3).join("/") || null;
}

function environmentStrings(value: unknown): string[] {
  if (typeof value === "string") return [value.toLowerCase().trim()];
  if (Array.isArray(value)) {
    return value.flatMap((item) => environmentStrings(item));
  }
  if (isRecord(value)) {
    return [firstString(value.name, value.value, value.environment)]
      .filter((item): item is string => Boolean(item))
      .map((item) => item.toLowerCase().trim());
  }
  return [];
}

function environmentTags(value: unknown): string[] {
  const environments: string[] = [];
  if (isRecord(value)) {
    for (const [key, tagValue] of Object.entries(value)) {
      if (/^env(?:ironment)?$/i.test(key))
        environments.push(...environmentStrings(tagValue));
    }
  } else if (Array.isArray(value)) {
    for (const tag of value) {
      if (Array.isArray(tag) && /^env(?:ironment)?$/i.test(String(tag[0]))) {
        environments.push(...environmentStrings(tag[1]));
      } else if (isRecord(tag) && /^env(?:ironment)?$/i.test(String(tag.key))) {
        environments.push(...environmentStrings(tag.value));
      }
    }
  }
  return environments;
}

const developmentEnvironments = new Set([
  "development",
  "dev",
  "local",
  "localhost",
  "test",
  "testing",
  "qa",
  "preview",
  "staging",
  "sandbox",
]);

const productionEnvironments = new Set(["production", "prod"]);

function issueEnvironments(issue: UnknownRecord): string[] {
  const latestEvent = nestedRecord(issue, "latestEvent");
  const events = nestedRecords(issue, "events");
  return [
    ...environmentStrings(recordValue(issue, "environment")),
    ...environmentStrings(recordValue(issue, "environments")),
    ...environmentStrings(recordValue(latestEvent ?? {}, "environment")),
    ...environmentTags(recordValue(issue, "tags")),
    ...environmentTags(recordValue(latestEvent ?? {}, "tags")),
    ...events.flatMap((event) => [
      ...environmentStrings(recordValue(event, "environment")),
      ...environmentTags(recordValue(event, "tags")),
    ]),
  ].filter(Boolean);
}

function isDevelopmentOnly(issue: UnknownRecord): boolean {
  const environments = issueEnvironments(issue);
  if (environments.length === 0) return false;
  if (
    environments.some((environment) => productionEnvironments.has(environment))
  )
    return false;
  return environments.every((environment) =>
    developmentEnvironments.has(environment),
  );
}

function tagEntries(value: unknown): Array<[string, unknown]> {
  if (isRecord(value)) return Object.entries(value);
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (
      Array.isArray(item) &&
      item.length >= 2 &&
      typeof item[0] === "string"
    ) {
      return [[item[0], item[1]] as [string, unknown]];
    }
    if (isRecord(item) && typeof item.key === "string") {
      return [[item.key, item.value] as [string, unknown]];
    }
    return [];
  });
}

function safeTags(
  issue: UnknownRecord,
  latestEvent: UnknownRecord | null,
): Record<string, string> {
  const allowedKeys = new Set([
    "environment",
    "browser",
    "runtime",
    "os",
    "level",
    "handled",
  ]);
  const tags: Record<string, string> = {};
  for (const [rawKey, rawValue] of [
    ...tagEntries(recordValue(issue, "tags")),
    ...tagEntries(recordValue(latestEvent ?? {}, "tags")),
  ]) {
    const key = rawKey.trim().toLowerCase();
    if (!allowedKeys.has(key) || key in tags) continue;
    const value = sanitizeExternalText(rawValue, 120);
    if (value) tags[key] = value;
  }
  return tags;
}

function normalizedDate(value: unknown): string | null {
  const candidate = stringValue(value);
  if (!candidate) return null;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function countValue(...values: unknown[]): number {
  for (const value of values) {
    const number = numberValue(value);
    if (number !== null && number >= 0)
      return Math.min(Math.floor(number), 1_000_000_000);
  }
  return 0;
}

function exceptionValue(
  issue: UnknownRecord,
  latestEvent: UnknownRecord | null,
): UnknownRecord | null {
  const eventException = nestedRecord(latestEvent ?? {}, "exception");
  const issueException = nestedRecord(issue, "exception");
  const values = [
    ...nestedRecords(eventException ?? {}, "values"),
    ...nestedRecords(issueException ?? {}, "values"),
  ];
  return values.at(-1) ?? null;
}

function frameValues(
  exception: UnknownRecord | null,
  issue: UnknownRecord,
  latestEvent: UnknownRecord | null,
): unknown[] {
  const stacktraces = [
    nestedRecord(exception ?? {}, "stacktrace"),
    nestedRecord(issue, "stacktrace"),
    nestedRecord(latestEvent ?? {}, "stacktrace"),
  ];
  return stacktraces.flatMap((stacktrace) => {
    const frames = recordValue(stacktrace ?? {}, "frames");
    return Array.isArray(frames) ? frames : [];
  });
}

function safeFrame(frame: unknown): string | null {
  if (!isRecord(frame)) return null;
  const functionName = sanitizeExternalText(
    firstString(frame.function, frame.module, frame.symbol) ?? "",
    100,
  );
  const filename = sanitizePath(
    firstString(frame.filename, frame.absPath, frame.package),
  );
  const line = numberValue(frame.lineNo ?? frame.lineno);
  const location = filename
    ? `${filename}${line !== null && line > 0 ? `:${Math.floor(line)}` : ""}`
    : "";
  const parts = [functionName, location].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(" @ ");
}

export function sanitizeSentryIssue(value: unknown): SanitizedSentryIssue {
  const issue = isRecord(value) ? value : {};
  const latestEvent = nestedRecord(issue, "latestEvent");
  const exception = exceptionValue(issue, latestEvent);
  const metadata = nestedRecord(issue, "metadata");
  const message = sanitizeExternalText(
    firstString(
      recordValue(latestEvent ?? {}, "message"),
      recordValue(exception ?? {}, "value"),
      recordValue(issue, "message"),
      recordValue(metadata ?? {}, "value"),
    ) ?? "",
    700,
  );
  const exceptionType = sanitizeExternalText(
    firstString(
      recordValue(exception ?? {}, "type"),
      recordValue(metadata ?? {}, "type"),
      recordValue(issue, "type"),
    ) ?? "",
    160,
  );
  const stack = frameValues(exception, issue, latestEvent)
    .map(safeFrame)
    .filter((frame): frame is string => Boolean(frame))
    .slice(-8);
  const title =
    sanitizeExternalText(
      firstString(
        recordValue(issue, "title"),
        recordValue(issue, "culprit"),
        exceptionType,
        message,
      ) ?? "",
      240,
    ) || "Unspecified Sentry issue";
  const culprit =
    sanitizeExternalText(
      firstString(recordValue(issue, "culprit")) ?? "",
      240,
    ) || null;
  const platform =
    sanitizeExternalText(
      firstString(
        recordValue(issue, "platform"),
        recordValue(latestEvent ?? {}, "platform"),
      ) ?? "",
      80,
    ) || null;
  const level =
    sanitizeExternalText(
      firstString(
        recordValue(issue, "level"),
        recordValue(latestEvent ?? {}, "level"),
      ) ?? "",
      40,
    ) || null;
  const eventCount = countValue(
    recordValue(issue, "count"),
    recordValue(issue, "timesSeen"),
    recordValue(issue, "eventCount"),
  );
  const userCount = countValue(
    recordValue(issue, "userCount"),
    recordValue(issue, "usersSeen"),
  );

  return {
    title,
    environment: "production",
    rootCauseEvidence: {
      culprit,
      exceptionType: exceptionType || null,
      message: message || null,
      stack,
      platform,
      level,
      tags: safeTags(issue, latestEvent),
    },
    recurrence: {
      eventCount,
      userCount,
      firstSeen: normalizedDate(recordValue(issue, "firstSeen")),
      lastSeen: normalizedDate(recordValue(issue, "lastSeen")),
    },
  };
}

export const sanitizeSentryText = sanitizeExternalText;

function opaqueIssueId(value: unknown): string | undefined {
  const candidate = stringValue(value)?.trim();
  if (!candidate || candidate.length > 128) return undefined;
  if (
    /(?:bearer|basic|sk-|ghp_|gho_|github_pat|xox[baprs]-)/i.test(candidate)
  ) {
    return undefined;
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(candidate)) return undefined;
  return candidate;
}

function issueIdentity(
  issue: UnknownRecord,
  sanitized: SanitizedSentryIssue,
): string {
  const providerId = opaqueIssueId(recordValue(issue, "id"));
  if (providerId) return `id:${providerId}`;
  const providerFingerprint = opaqueIssueId(recordValue(issue, "fingerprint"));
  if (providerFingerprint) return `fingerprint:${providerFingerprint}`;
  return `value:${fingerprintIdentity(sanitized)}`;
}

function fingerprintIdentity(issue: SanitizedSentryIssue): string {
  const evidence = issue.rootCauseEvidence;
  return (
    [
      issue.title,
      evidence.exceptionType,
      evidence.culprit,
      evidence.message,
      evidence.stack[0],
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim() || "unspecified-issue"
  );
}

function parseCursor(value: unknown): string | null {
  const candidate = stringValue(value);
  if (!candidate || candidate.length > 512) return null;
  try {
    const url = new URL(candidate, "https://sentry.invalid");
    const cursor = url.searchParams.get("cursor");
    if (cursor && cursor.length <= 512) return cursor;
  } catch {
    return null;
  }
  return candidate.includes("?") || candidate.includes("&") ? null : candidate;
}

function linkNext(link: string | null): {
  hasNext: boolean;
  cursor: string | null;
} {
  if (!link) return { hasNext: false, cursor: null };
  const next = link
    .split(",")
    .find((part) => /(?:^|;)\s*rel="?next"?/i.test(part));
  if (!next) return { hasNext: false, cursor: null };
  const cursor = parseCursor(next.match(/(?:^|;)\s*cursor="([^"]+)"/i)?.[1]);
  const results = next.match(/(?:^|;)\s*results="?([^";]+)"?/i)?.[1];
  const hasNext = results === undefined || !/^(?:false|0)$/i.test(results);
  return hasNext ? { hasNext: true, cursor } : { hasNext: false, cursor: null };
}

function responsePage(value: unknown, response: Response): SentryPage {
  let issues: unknown[];
  let metadata: UnknownRecord = {};

  if (Array.isArray(value)) {
    issues = value;
  } else if (isRecord(value)) {
    const issueValue =
      recordValue(value, "issues") ??
      recordValue(value, "data") ??
      recordValue(value, "items");
    if (!Array.isArray(issueValue)) {
      throw new SentryCollectorError(
        "invalid_provider_response",
        "Sentry returned an invalid issue list.",
        response.status,
      );
    }
    issues = issueValue;
    metadata = value;
  } else {
    throw new SentryCollectorError(
      "invalid_provider_response",
      "Sentry returned an invalid issue list.",
      response.status,
    );
  }

  if (!issues.every(isRecord)) {
    throw new SentryCollectorError(
      "invalid_provider_response",
      "Sentry returned an invalid issue list.",
      response.status,
    );
  }

  const headerLink = linkNext(
    typeof response.headers?.get === "function"
      ? response.headers.get("link")
      : null,
  );
  const nextValue =
    recordValue(metadata, "next") ?? recordValue(metadata, "nextCursor");
  const nextCursor = headerLink.cursor ?? parseCursor(nextValue);
  const nextMarkerPresent =
    nextValue === true ||
    (typeof nextValue === "string" && nextValue.trim().length > 0);
  const hasNext =
    headerLink.hasNext ||
    nextCursor !== null ||
    nextMarkerPresent ||
    recordValue(metadata, "hasMore") === true ||
    recordValue(metadata, "has_more") === true;
  const total = numberValue(
    recordValue(metadata, "total") ??
      recordValue(metadata, "totalCount") ??
      recordValue(metadata, "count"),
  );

  return {
    issues: issues as UnknownRecord[],
    nextCursor,
    hasNext,
    total,
  };
}

function emitAudit(
  audit: AuditLogger,
  record: Parameters<AuditLogger>[0],
): void {
  try {
    audit(record);
  } catch {
    // Audit failures must not expose provider data or change triage behavior.
  }
}

function defaultAudit(record: Parameters<AuditLogger>[0]): void {
  console.log(JSON.stringify(record));
}

function configError(): SentryCollectorError {
  return new SentryCollectorError(
    "invalid_configuration",
    "Sentry collector configuration is invalid.",
  );
}

function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw configError();
    }
    return url.toString().replace(/\/$/, "");
  } catch (error) {
    if (error instanceof SentryCollectorError) throw error;
    throw configError();
  }
}

function requiredSegment(value: unknown): string {
  const candidate = stringValue(value)?.trim();
  if (
    !candidate ||
    candidate.length > 100 ||
    !/^[A-Za-z0-9._-]+$/.test(candidate)
  ) {
    throw configError();
  }
  return candidate;
}

function collectorConfig(options: SentryCollectorOptions): CollectorConfig {
  const baseUrl =
    options.baseUrl ??
    options.apiBaseUrl ??
    process.env.SENTRY_BASE_URL ??
    "https://sentry.io";
  const organization =
    options.organization ??
    options.organizationSlug ??
    options.org ??
    process.env.SENTRY_ORGANIZATION;
  const project =
    options.project ?? options.projectSlug ?? process.env.SENTRY_PROJECT;
  const token =
    options.readToken ??
    options.token ??
    process.env.SENTRY_READ_TOKEN ??
    process.env.SENTRY_AUTH_TOKEN;
  if (typeof baseUrl !== "string" || typeof token !== "string" || !token.trim())
    throw configError();

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    organization: requiredSegment(organization),
    project: requiredSegment(project),
    token,
    fetchImpl: options.fetchImpl ?? options.fetchImplementation ?? fetch,
    audit: options.audit ?? defaultAudit,
    pageSize: boundedNumber(options.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    maxPages: boundedNumber(options.maxPages, DEFAULT_MAX_PAGES, MAX_PAGES),
    maxRequests: boundedNumber(
      options.maxRequests,
      DEFAULT_MAX_REQUESTS,
      MAX_REQUESTS,
    ),
    timeoutMs: boundedNumber(options.timeoutMs, 8_000, 60_000),
  };
}

async function fetchSentryPage(
  config: CollectorConfig,
  cursor: string | null,
  page: number,
): Promise<SentryPage> {
  const endpoint = `${config.baseUrl}/api/0/projects/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}/issues/`;
  const params = new URLSearchParams({
    query: "is:unresolved",
    environment: "production",
    limit: String(config.pageSize),
  });
  if (cursor) params.set("cursor", cursor);
  const requestUrl = `${endpoint}?${params.toString()}`;
  const startedAt = performance.now();
  const requestAudit = {
    method: "GET",
    resource: "sentry-unresolved-issues",
    page,
    pageSize: config.pageSize,
    query: {
      unresolved: true,
      environment: "production",
      cursor: cursor ? "[redacted]" : null,
    },
  } satisfies Record<string, JsonValue>;

  try {
    const response = await config.fetchImpl(requestUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      signal:
        typeof AbortSignal !== "undefined" &&
        typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(config.timeoutMs)
          : undefined,
    });
    const body: unknown = await response.json().catch(() => null);
    const responseOk =
      response.ok === true ||
      (response.ok === undefined &&
        response.status >= 200 &&
        response.status < 300);
    if (!responseOk) {
      emitAudit(config.audit, {
        adapter: "sentry-rest",
        operation: "list-unresolved-production-issues",
        status: "failure",
        latencyMs: Math.round(performance.now() - startedAt),
        request: requestAudit,
        response: {
          httpStatus: response.status,
          error: "sentry_request_failed",
        },
      });
      throw new SentryCollectorError(
        "request_failed",
        "Sentry REST request failed.",
        response.status,
      );
    }

    let parsed: SentryPage;
    try {
      parsed = responsePage(body, response);
    } catch (error) {
      emitAudit(config.audit, {
        adapter: "sentry-rest",
        operation: "list-unresolved-production-issues",
        status: "failure",
        latencyMs: Math.round(performance.now() - startedAt),
        request: requestAudit,
        response: {
          httpStatus: response.status,
          error: "invalid_provider_response",
        },
        schemaValid: false,
      });
      throw error;
    }

    emitAudit(config.audit, {
      adapter: "sentry-rest",
      operation: "list-unresolved-production-issues",
      status: "success",
      latencyMs: Math.round(performance.now() - startedAt),
      request: requestAudit,
      response: {
        httpStatus: response.status,
        issueCount: parsed.issues.length,
        hasNext: parsed.hasNext,
        total: parsed.total,
      },
      schemaValid: true,
    });
    return parsed;
  } catch (error) {
    if (error instanceof SentryCollectorError) throw error;
    emitAudit(config.audit, {
      adapter: "sentry-rest",
      operation: "list-unresolved-production-issues",
      status: "failure",
      latencyMs: Math.round(performance.now() - startedAt),
      request: requestAudit,
      response: { httpStatus: null, error: "sentry_request_failed" },
    });
    throw new SentryCollectorError(
      "request_failed",
      "Sentry REST request failed.",
    );
  }
}

async function collectIssueCandidates(
  options: SentryCollectorOptions,
): Promise<{
  candidates: SentryIssueCandidate[];
  incidentMode: boolean;
  hasMore: boolean;
  requestCount: number;
}> {
  const config = collectorConfig(options);
  const candidates: SentryIssueCandidate[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let requestCount = 0;
  let pageCount = 0;
  let hasMore = false;
  let totalFromProvider: number | null = null;
  let paginationIncomplete = false;

  while (requestCount < config.maxRequests && pageCount < config.maxPages) {
    const page = await fetchSentryPage(config, cursor, pageCount + 1);
    requestCount += 1;
    pageCount += 1;
    totalFromProvider = page.total ?? totalFromProvider;

    for (const rawIssue of page.issues) {
      if (isDevelopmentOnly(rawIssue)) continue;
      const sanitized = sanitizeSentryIssue(rawIssue);
      const identity = issueIdentity(rawIssue, sanitized);
      if (seen.has(identity)) continue;
      seen.add(identity);
      candidates.push({
        issue: sanitized,
        issueId:
          opaqueIssueId(recordValue(rawIssue, "id")) ??
          opaqueIssueId(recordValue(rawIssue, "shortId")),
      });
    }

    hasMore = page.hasNext;
    if (!page.hasNext) break;
    if (candidates.length >= MAX_ANALYZED_ISSUES) break;
    if (!page.nextCursor) {
      paginationIncomplete = true;
      break;
    }
    cursor = page.nextCursor;
  }

  const boundedCandidates = candidates.slice(0, MAX_ANALYZED_ISSUES);
  const incidentMode =
    candidates.length > MAX_ANALYZED_ISSUES ||
    (boundedCandidates.length === MAX_ANALYZED_ISSUES && hasMore) ||
    (hasMore &&
      (requestCount >= config.maxRequests || pageCount >= config.maxPages)) ||
    paginationIncomplete ||
    (totalFromProvider !== null && totalFromProvider > MAX_ANALYZED_ISSUES);

  return {
    candidates: boundedCandidates,
    incidentMode,
    hasMore: incidentMode || hasMore,
    requestCount,
  };
}

export async function collectSentryIssues(
  options: SentryCollectorOptions = {},
): Promise<SentryIssueCollection> {
  const collected = await collectIssueCandidates(options);
  return {
    issues: collected.candidates.map((candidate) => candidate.issue),
    incidentMode: collected.incidentMode,
    hasMore: collected.hasMore,
    requestCount: collected.requestCount,
    candidateIssueCount: collected.candidates.length,
  };
}

function parseClassifierJson(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length > MAX_CLASSIFIER_OUTPUT)
      throw new Error("classifier output too large");
    return JSON.parse(value);
  }
  if (isRecord(value)) return value;
  throw new Error("classifier output is not JSON");
}

function sanitizedClassification(value: SentryClassification): {
  classification: SentryClassification;
  textWasRedacted: boolean;
} {
  const rootCause =
    sanitizeExternalText(value.rootCause, 500) || "Root cause unavailable.";
  const recurrenceEvidence =
    sanitizeExternalText(value.recurrence.evidence, 400) ||
    "Recurrence evidence unavailable.";
  const recommendedAction =
    sanitizeExternalText(value.recommendedAction, 500) ||
    "Human review is required.";
  const paths = value.sensitivePaths
    .map(sanitizePath)
    .filter((path): path is string => Boolean(path));
  const changedFiles = (value.changedFiles ?? [])
    .map(sanitizePath)
    .filter((path): path is string => Boolean(path));
  const rootCauseKey = value.rootCauseKey
    ? sanitizeExternalText(value.rootCauseKey, 200)
    : undefined;
  const textWasRedacted =
    rootCause !== value.rootCause ||
    recurrenceEvidence !== value.recurrence.evidence ||
    recommendedAction !== value.recommendedAction ||
    paths.some((path, index) => path !== value.sensitivePaths[index]);
  const repairMetadataWasRedacted =
    changedFiles.some(
      (path, index) => path !== (value.changedFiles ?? [])[index],
    ) || rootCauseKey !== value.rootCauseKey;

  return {
    classification: {
      ...value,
      rootCause,
      recurrence: { ...value.recurrence, evidence: recurrenceEvidence },
      sensitivePaths:
        value.sensitivePaths.length > 0 && paths.length === 0
          ? ["[redacted path]"]
          : paths,
      ...(value.changedFiles
        ? {
            changedFiles:
              value.changedFiles.length > 0 && changedFiles.length === 0
                ? ["[redacted path]"]
                : changedFiles,
          }
        : {}),
      ...(rootCauseKey ? { rootCauseKey } : {}),
      recommendedAction,
    },
    textWasRedacted: textWasRedacted || repairMetadataWasRedacted,
  };
}

function likelyApplicationDefect(rootCause: string): boolean {
  return !/\b(?:infrastructure|network|third[- ]party|vendor|dependency|configuration|config(?:uration)?|credential|authentication|authorization|permission|database|migration|schema|data loss|privacy|security|deployment|secret|token)\b/i.test(
    rootCause,
  );
}

export interface MergePolicyDecision {
  mergePolicy: MergePolicy;
  humanReason?: string;
}

export function decideSentryMergePolicy(
  classification: SentryClassification,
  options: { incidentMode?: boolean; textWasRedacted?: boolean } = {},
): MergePolicyDecision {
  const reasons: string[] = [];
  if (classification.mergePolicy === "human")
    reasons.push("Classifier requested human review.");
  if (classification.severity === "critical")
    reasons.push("Critical severity requires human review.");
  if (classification.confidence < HIGH_CONFIDENCE)
    reasons.push("Confidence is below the automatic-merge threshold.");
  if (!classification.reproducible)
    reasons.push("The defect is not reproducible.");
  if (classification.behaviorChangeRisk !== "low")
    reasons.push("The proposed change may alter behavior.");
  if (classification.sensitivePaths.length > 0)
    reasons.push("Sensitive paths require human review.");
  if (classification.fixability !== "high")
    reasons.push("Fixability is not high confidence.");
  if (!classification.changedFiles?.length)
    reasons.push("No repository files were identified for a bounded repair.");
  if (!likelyApplicationDefect(classification.rootCause))
    reasons.push("The root cause is not a clearly scoped application defect.");
  if (options.incidentMode)
    reasons.push(
      "The bounded issue limit was exceeded; human triage is required.",
    );
  if (options.textWasRedacted)
    reasons.push("Classifier text required sanitization.");

  return reasons.length === 0
    ? { mergePolicy: "automatic" }
    : { mergePolicy: "human", humanReason: reasons.join(" ") };
}

function auditClassifier(
  audit: AuditLogger,
  attempt: number,
  status: "success" | "failure",
  latencyMs: number,
  schemaValid: boolean,
): void {
  emitAudit(audit, {
    adapter: "sentry-classifier",
    operation: "classify-sanitized-issue",
    status,
    latencyMs,
    request: {
      attempt,
      filename: "sentry-issue.json",
      mediaType: "application/json",
    },
    response:
      status === "success"
        ? { result: "accepted" }
        : { error: "invalid_json_or_schema" },
    schemaValid,
  });
}

interface ClassifiedSentryResult {
  classification: SentryClassification;
  textWasRedacted: boolean;
}

async function classifySentryIssueInternal(
  issue: SanitizedSentryIssue,
  classifier: SentryClassifier,
  options: { audit?: AuditLogger } = {},
): Promise<ClassifiedSentryResult> {
  const audit = options.audit ?? defaultAudit;
  const payload: SentryClassifierPayload = {
    filename: "sentry-issue.json",
    mediaType: "application/json",
    value: issue,
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = performance.now();
    try {
      const output = await classifier(payload);
      const parsed = parseClassifierJson(output);
      const result = SentryClassificationSchema.safeParse(parsed);
      if (!result.success)
        throw new Error("classifier schema validation failed");
      auditClassifier(
        audit,
        attempt,
        "success",
        Math.round(performance.now() - startedAt),
        true,
      );
      return sanitizedClassification(result.data);
    } catch {
      auditClassifier(
        audit,
        attempt,
        "failure",
        Math.round(performance.now() - startedAt),
        false,
      );
      if (attempt === 2) throw new SentryClassifierError(2);
    }
  }

  throw new SentryClassifierError(2);
}

export async function classifySentryIssue(
  issue: SanitizedSentryIssue,
  classifier: SentryClassifier,
  options: { audit?: AuditLogger } = {},
): Promise<SentryClassification> {
  const result = await classifySentryIssueInternal(issue, classifier, options);
  return result.classification;
}

export function buildSentryHealthFinding(
  issue: SanitizedSentryIssue,
  classification: SentryClassification,
  options: { incidentMode?: boolean; textWasRedacted?: boolean } = {},
  issueId?: string,
): HealthFinding {
  const safeClassification = sanitizedClassification(classification);
  const safeIssueId = opaqueIssueId(issueId);
  const policy = decideSentryMergePolicy(safeClassification.classification, {
    incidentMode: options.incidentMode,
    textWasRedacted:
      options.textWasRedacted ?? safeClassification.textWasRedacted,
  });
  const evidence: Record<string, JsonValue> = {
    recurrence: {
      isRecurring: issue.recurrence.eventCount > 1,
      eventCount: issue.recurrence.eventCount,
      userCount: issue.recurrence.userCount,
      firstSeen: issue.recurrence.firstSeen,
      lastSeen: issue.recurrence.lastSeen,
    },
    rootCauseEvidence: {
      culprit: issue.rootCauseEvidence.culprit,
      exceptionType: issue.rootCauseEvidence.exceptionType,
      message: issue.rootCauseEvidence.message,
      stack: issue.rootCauseEvidence.stack,
      platform: issue.rootCauseEvidence.platform,
      level: issue.rootCauseEvidence.level,
      tags: issue.rootCauseEvidence.tags,
    },
    classification: {
      rootCause: safeClassification.classification.rootCause,
      confidence: safeClassification.classification.confidence,
      recurrence: safeClassification.classification.recurrence,
      reproducible: safeClassification.classification.reproducible,
      fixability: safeClassification.classification.fixability,
      behaviorChangeRisk: safeClassification.classification.behaviorChangeRisk,
      sensitivePaths: safeClassification.classification.sensitivePaths,
      changedFiles: safeClassification.classification.changedFiles ?? [],
      rootCauseKey:
        safeClassification.classification.rootCauseKey ??
        stableFingerprint(
          "sentry",
          "root-cause",
          safeClassification.classification.rootCause,
        ),
      defectKind: safeClassification.classification.defectKind ?? "application",
      ...(safeClassification.classification.dependencyImpact
        ? {
            dependencyImpact:
              safeClassification.classification.dependencyImpact,
          }
        : {}),
      evidenceArtifactRef: safeIssueId
        ? `sentry-triage:${safeIssueId}`
        : `sentry-triage:${fingerprintIdentity(issue)}`,
      recommendedAction: safeClassification.classification.recommendedAction,
    },
  };
  const finding: HealthFinding = {
    source: "sentry",
    fingerprint: stableFingerprint(
      "sentry",
      "issue",
      safeIssueId ?? fingerprintIdentity(issue),
    ),
    title: issue.title,
    severity: safeClassification.classification.severity as HealthSeverity,
    evidence,
    mergePolicy: policy.mergePolicy,
    ...(policy.humanReason ? { humanReason: policy.humanReason } : {}),
    ...(safeIssueId ? { sentryIssueId: safeIssueId } : {}),
  };
  return finding;
}

export async function collectSentryFindings(
  options: SentryFindingsOptions,
): Promise<SentryCollectionResult> {
  if (typeof options.classifier !== "function") throw configError();
  const collected = await collectIssueCandidates(options);
  const audit = options.audit ?? defaultAudit;
  const findings: HealthFinding[] = [];

  for (const candidate of collected.candidates) {
    const classified = await classifySentryIssueInternal(
      candidate.issue,
      options.classifier,
      { audit },
    );
    findings.push(
      buildSentryHealthFinding(
        candidate.issue,
        classified.classification,
        {
          incidentMode: options.incidentMode ?? collected.incidentMode,
          textWasRedacted: classified.textWasRedacted,
        },
        candidate.issueId,
      ),
    );
  }

  return {
    issues: collected.candidates.map((candidate) => candidate.issue),
    incidentMode: collected.incidentMode,
    hasMore: collected.hasMore,
    requestCount: collected.requestCount,
    candidateIssueCount: collected.candidates.length,
    findings,
    analyzedIssueCount: findings.length,
  };
}
