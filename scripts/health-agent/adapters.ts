import {
  requiresHumanPolicy,
  type AuditLogger,
  type HealthFinding,
  type JsonValue,
} from "./contracts";

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
    emitAudit(
      deps.audit,
      adapter,
      operation,
      "failure",
      elapsed(deps.clock, startedAt),
      options.request,
      { httpStatus: status },
      parsed.parsed,
    );
    throw new HealthAdapterError(
      `${displayName} request failed`,
      adapter,
      operation,
      status,
    );
  }

  const schemaValid =
    parsed.parsed && (!options.validate || options.validate(parsed.value));
  if (!schemaValid) {
    emitAudit(
      deps.audit,
      adapter,
      operation,
      "failure",
      elapsed(deps.clock, startedAt),
      options.request,
      { httpStatus: status, error: "invalid_response" },
      false,
    );
    throw new HealthAdapterError(
      `${displayName} returned an invalid response`,
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

function jsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable]";
  }
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
  return findings.map((value) => {
    if (!isRecord(value)) return `- ${jsonText(value)}`;
    const title = stringValue(value.title) ?? "Untitled finding";
    const source = stringValue(value.source) ?? "unknown";
    const severity = stringValue(value.severity)?.toUpperCase() ?? "UNKNOWN";
    const fingerprint = stringValue(value.fingerprint) ?? "unknown";
    const evidence = isRecord(value.evidence) ? jsonText(value.evidence) : "{}";
    const reason = stringValue(value.humanReason);
    return [
      `- [${severity}] ${title} (${source})`,
      `  fingerprint: ${fingerprint}`,
      `  evidence: ${evidence}`,
      ...(reason ? [`  human reason: ${reason}`] : []),
    ].join("\n");
  });
}

function noteLines(entries: unknown[]): string[] {
  return entries.map((entry) => {
    if (typeof entry === "string") return `- ${entry}`;
    return `- ${jsonText(entry)}`;
  });
}

export type SlackEntry = string | Readonly<Record<string, JsonValue>>;

export interface SlackReport {
  actionableFindings?: readonly HealthFinding[];
  failures?: readonly SlackEntry[] | SlackEntry;
  findings?: readonly HealthFinding[];
  linear?: readonly SlackEntry[] | SlackEntry;
  linearOutcomes?: readonly SlackEntry[] | SlackEntry;
  prOutcomes?: readonly SlackEntry[] | SlackEntry;
  pullRequests?: readonly SlackEntry[] | SlackEntry;
  pullRequestOutcomes?: readonly SlackEntry[] | SlackEntry;
  skipped?: readonly SlackEntry[] | SlackEntry;
  skippedActions?: readonly SlackEntry[] | SlackEntry;
}

export function renderSlackDigest(report: SlackReport): string {
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

  const sections: string[] = [];
  if (findings.length > 0) {
    sections.push(`*Actionable findings*\n${findingLines(findings)}`);
  }
  if (skipped.length > 0) {
    sections.push(`*Skipped actions*\n${noteLines(skipped)}`);
  }
  if (failures.length > 0) {
    sections.push(`*Failures*\n${noteLines(failures)}`);
  }
  if (linear.length > 0) {
    sections.push(`*Linear outcomes*\n${noteLines(linear)}`);
  }
  if (pullRequests.length > 0) {
    sections.push(`*PR outcomes*\n${noteLines(pullRequests)}`);
  }
  if (sections.length === 0) return "Formoria health agent: all clear.";
  return ["*Formoria health agent*", ...sections].join("\n\n");
}

const SLACK_TEXT_LIMIT = 2_999;

function chunkSlackText(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  const append = (value: string) => {
    if (Array.from(value).length <= SLACK_TEXT_LIMIT) {
      current = value;
      return;
    }
    const characters = Array.from(value);
    for (let index = 0; index < characters.length; index += SLACK_TEXT_LIMIT) {
      chunks.push(characters.slice(index, index + SLACK_TEXT_LIMIT).join(""));
    }
    current = "";
  };

  for (const line of text.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;
    if (Array.from(candidate).length <= SLACK_TEXT_LIMIT) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    append(line);
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
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
  const chunks = chunkSlackText(renderSlackDigest(report));
  for (const [index, text] of chunks.entries()) {
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
          chunkIndex: index + 1,
          chunkCount: chunks.length,
        },
      },
    );
  }
  return chunks.length;
}

export function createSlackAdapter(options: SlackAdapterOptions): SlackAdapter {
  return {
    sendDigest: (report) => sendSlackDigest(report, options),
    send: (report) => sendSlackDigest(report, options),
  };
}

function linearToken(options: LinearAdapterOptions): string {
  return asNonemptyString(
    options.oauthAccessToken ??
      options.oauthToken ??
      options.accessToken ??
      options.token,
    "Linear OAuth token is required",
  );
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

function issueNodes(value: unknown): Record<string, unknown>[] {
  const data = graphqlData(value);
  const container = data?.issues;
  return isRecord(container) && Array.isArray(container.nodes)
    ? container.nodes.filter(isRecord)
    : [];
}

export interface LinearAdapterOptions extends AdapterDependencies {
  accessToken?: string;
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

const LINEAR_LOOKUP_QUERY = `
  query HealthAgentIssueLookup($teamId: ID!, $projectId: ID!, $marker: String!) {
    issues(filter: { team: { id: { eq: $teamId } }, project: { id: { eq: $projectId } }, description: { contains: $marker } }, first: 10) {
      nodes { id identifier title description team { id } project { id } }
    }
  }
`;

const LINEAR_LABEL_QUERY = `
  query HealthAgentLabels($teamId: ID!) {
    issueLabels(filter: { team: { id: { eq: $teamId } } }, first: 100) {
      nodes { id name team { id } }
    }
  }
`;

const LINEAR_CREATE_MUTATION = `
  mutation HealthAgentIssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) { success issue { id identifier } }
  }
`;

const LINEAR_UPDATE_MUTATION = `
  mutation HealthAgentIssueUpdate($id: ID!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) { success issue { id identifier } }
  }
`;

function fingerprintMarker(fingerprint: string): string {
  return `<!-- health-agent:fingerprint:${fingerprint} -->`;
}

export const linearFingerprintMarker = fingerprintMarker;

function linearIssueDescription(
  finding: HealthFinding,
  marker: string,
): string {
  const evidence = jsonText(finding.evidence);
  return [
    marker,
    `Source: ${finding.source}`,
    `Fingerprint: ${finding.fingerprint}`,
    "",
    finding.title,
    "",
    `Evidence: ${evidence}`,
    ...(finding.humanReason ? [`Human reason: ${finding.humanReason}`] : []),
  ].join("\n");
}

function normalizeLinearInput(
  input: readonly HealthFinding[] | LinearSyncInput,
  options: LinearSyncOptions,
): { exhausted: Set<string>; findings: readonly HealthFinding[] } {
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
  return { exhausted, findings: value.findings };
}

function linearLabelName(finding: HealthFinding): "Data Quality" | "Ops" {
  return finding.source === "sentry" ? "Ops" : "Data Quality";
}

function linearMutationResult(
  data: Record<string, unknown>,
  field: "issueCreate" | "issueUpdate",
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
  const token = linearToken(options);
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
    Authorization: `Bearer ${token}`,
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

  const loadLabels = async (
    requiredLabel: "Data Quality" | "Ops",
  ): Promise<Map<"Data Quality" | "Ops", string>> => {
    if (labels) return labels;
    const data = await graphql(
      "lookup_labels",
      LINEAR_LABEL_QUERY,
      { teamId },
      (value) => graphqlDataHas("issueLabels", value),
    );
    const next = new Map<"Data Quality" | "Ops", string>();
    for (const node of labelNodes({ data })) {
      const name = node.name;
      const team = node.team;
      const id = stringValue(node.id);
      const teamValue = isRecord(team) ? stringValue(team.id) : undefined;
      if (
        id &&
        teamValue === teamId &&
        (name === "Data Quality" || name === "Ops")
      ) {
        next.set(name, id);
      }
    }
    if (!next.has(requiredLabel)) {
      emitAudit(
        deps.audit,
        "linear",
        "validate_labels",
        "failure",
        0,
        { configuredTeam: true },
        { error: "missing_allowed_labels" },
        true,
      );
      throw new HealthAdapterError(
        "Linear labels are not configured",
        "linear",
        "validate_labels",
      );
    }
    labels = next;
    return next;
  };

  for (const finding of eligible) {
    const marker = fingerprintMarker(finding.fingerprint);
    const lookup = await graphql(
      "lookup_issue",
      LINEAR_LOOKUP_QUERY,
      { marker, projectId, teamId },
      (value) => graphqlDataHas("issues", value),
    );
    const existing = issueNodes({ data: lookup }).find((node) => {
      const team = node.team;
      const project = node.project;
      return (
        isRecord(team) &&
        stringValue(team.id) === teamId &&
        isRecord(project) &&
        stringValue(project.id) === projectId
      );
    });
    const labelName = linearLabelName(finding);
    const allowedLabels = await loadLabels(labelName);
    const labelId = allowedLabels.get(labelName);
    if (!labelId) {
      throw new HealthAdapterError(
        "Linear label is not configured",
        "linear",
        "validate_labels",
      );
    }
    const inputPayload: Record<string, JsonValue> = {
      assigneeId,
      description: linearIssueDescription(finding, marker),
      labelIds: [labelId],
      projectId,
      title: finding.title,
    };

    if (existing) {
      const existingId = asNonemptyString(
        existing.id,
        "Linear issue ID is required",
      );
      const data = await graphql(
        "update_issue",
        LINEAR_UPDATE_MUTATION,
        { id: existingId, input: inputPayload },
        (value) => {
          const data = graphqlData(value);
          const mutation = data?.issueUpdate;
          return isRecord(mutation) && mutation.success === true;
        },
      );
      const mutation = linearMutationResult(data, "issueUpdate");
      result.updated += 1;
      result.outcomes.push({
        action: "updated",
        ...(mutation.identifier ? { identifier: mutation.identifier } : {}),
        fingerprint: finding.fingerprint,
      });
    } else {
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
        fingerprint: finding.fingerprint,
      });
    }
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
