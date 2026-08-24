import { auditedCall, type AuditStatus } from "@/lib/audit";
import {
  createPostHogQueryClient,
  type PostHogQueryClient,
} from "@/lib/adapters/posthog/query-api";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getExecutiveHealth,
  type ExecutiveHealthSnapshot,
  type ExecutiveServiceHealth,
} from "./executive-health";
import { getSpendSnapshot, type SpendSnapshotV1 } from "./spend";
import { SERVICE_REGISTRY, type ServiceEntry } from "./service-registry";

type UsageState =
  "ready" | "unsupported" | "unconfigured" | "error" | "not_applicable";
export type UsageRisk = "normal" | "warning" | "critical" | "unknown";
type UsageCompleteness = "exact" | "lower_bound";
type OperationalHealthStatus = "healthy" | "warning" | "critical" | "unknown";

type UsageWindow = { start: string; end: string };

type UsageMetric = {
  value: number | null;
  unit: string;
  limit: number | null;
  percentage: number | null;
  window: UsageWindow;
  // What this reading is *about* when the service row's name is not precise
  // enough -- the Railway memory metric is one service out of the two the row
  // covers, and a warning that does not name it leaves the operator guessing.
  // `null` on every metric whose service row already identifies it.
  subject: string | null;
  source: string;
  completeness: UsageCompleteness;
  freshness: string | null;
  projection: number | null;
  risk: UsageRisk;
};

type OperationalHealthCheck = {
  id: string;
  name: string;
  status: ExecutiveServiceHealth["status"] | "unknown";
  message: string;
  checkedAt: string | null;
};

type OperationalServiceRow = {
  id: string;
  name: string;
  service: string;
  vendor: string;
  section: Exclude<ServiceEntry["operationalSection"], null>;
  plan: {
    kind: ServiceEntry["plan"]["kind"];
    sourceDate: string;
  };
  subscription: {
    amountUsd: number;
    billingNote: string;
    sourceDate: string;
  } | null;
  dashboardUrl: string | null;
  health: {
    status: OperationalHealthStatus;
    message: string;
    checkedAt: string | null;
    checks: OperationalHealthCheck[];
  };
  usage: {
    state: UsageState;
    message: string | null;
    primary: UsageMetric | null;
    secondary: UsageMetric | null;
    additional: UsageMetric[];
  };
};

export type OperationalSnapshotV1 = {
  schemaVersion: 1;
  generatedAt: string;
  status: OperationalHealthStatus;
  services: OperationalServiceRow[];
};

type OperationalAlertMeter = {
  state: UsageState;
  risk: UsageRisk;
  value: number | null;
  limit: number | null;
  percentage: number | null;
  projection: number | null;
  message: string | null;
  // The period the reading covers. Carried through to Slack because the
  // Railway meters report a completed UTC day while the OpenAI and Upstash
  // meters in the same message report the current period -- a report headed
  // with a Taipei date gives the reader no cue that the lines differ.
  window: UsageWindow | null;
  // Which Railway service the reading belongs to, when the row covers more
  // than one. `null` for meters whose row already names the subject.
  subject: string | null;
};

export type OperationalAlertSummary = {
  needsAttention: boolean;
  unavailableUpstash: boolean;
  unavailableRailway: boolean;
  warnings: string[];
  lowerBoundCaveats: string[];
  openai: OperationalAlertMeter | null;
  upstash: OperationalAlertMeter | null;
  posthog: OperationalAlertMeter | null;
  railway: OperationalAlertMeter | null;
  railwayMemory: OperationalAlertMeter | null;
};

export type UsageMetricInput = {
  value: number;
  limit: number | null;
  completeness: UsageCompleteness;
  projection: number | null;
};

export function assessUsageRisk(input: UsageMetricInput): UsageRisk {
  if (
    !Number.isFinite(input.value) ||
    input.limit === null ||
    !Number.isFinite(input.limit) ||
    input.limit <= 0
  ) {
    return "unknown";
  }

  const ratio = input.value / input.limit;
  if (ratio >= 0.9) return "critical";
  if (ratio >= 0.7) return "warning";
  if (input.projection !== null && input.projection >= 1) return "warning";
  return input.completeness === "lower_bound" ? "unknown" : "normal";
}

function utcMonthWindow(at: Date): UsageWindow {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayWindow(at: Date): UsageWindow {
  const start = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
  const end = new Date(start.getTime() + DAY_MS);
  return { start: start.toISOString(), end: end.toISOString() };
}

// The window that ends with `at`'s UTC day and reaches back `days` whole days,
// so `utcTrailingDaysWindow(at, 7)` covers a seven-day trailing mean.
function utcTrailingDaysWindow(at: Date, days: number): UsageWindow {
  const day = utcDayWindow(at);
  return {
    start: new Date(Date.parse(day.start) - (days - 1) * DAY_MS).toISOString(),
    end: day.end,
  };
}

function projectionFor(
  value: number,
  limit: number | null,
  window: UsageWindow,
  at: Date,
  completeness: UsageCompleteness,
): number | null {
  if (completeness === "lower_bound" || limit === null || limit <= 0)
    return null;
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return null;
  const elapsed = Math.min(
    1,
    Math.max(0, (at.getTime() - start) / (end - start)),
  );
  if (elapsed <= 0) return null;
  return value / elapsed / limit;
}

function createMetric({
  value,
  unit,
  limit,
  window,
  subject = null,
  source,
  completeness = "exact",
  freshness,
  projection: projectionOverride,
  at,
}: {
  value: number;
  unit: string;
  limit: number | null;
  window: UsageWindow;
  subject?: string | null;
  source: string;
  completeness?: UsageCompleteness;
  freshness?: string | null;
  projection?: number | null;
  at: Date;
}): UsageMetric {
  const percentage = limit !== null && limit > 0 ? value / limit : null;
  const projection =
    projectionOverride === undefined
      ? projectionFor(value, limit, window, at, completeness)
      : projectionOverride;
  return {
    value,
    unit,
    limit,
    percentage,
    window,
    subject,
    source,
    completeness,
    freshness: freshness ?? at.toISOString(),
    projection,
    risk: assessUsageRisk({ value, limit, completeness, projection }),
  };
}

function emptyUsage(
  state: UsageState,
  message: string | null = null,
): OperationalServiceRow["usage"] {
  return { state, message, primary: null, secondary: null, additional: [] };
}

function fixedSubscription(
  entry: ServiceEntry,
): OperationalServiceRow["subscription"] {
  if (entry.plan.monthlyUsd === undefined || entry.plan.monthlyUsd <= 0)
    return null;
  return {
    amountUsd: entry.plan.monthlyUsd,
    billingNote:
      entry.plan.monthlyUsd === 0
        ? "Free plan"
        : (entry.notes?.split(".")[0] ?? "Fixed monthly subscription"),
    sourceDate: entry.plan.asOf,
  };
}

function healthStatus(
  checks: OperationalHealthCheck[],
): OperationalServiceRow["health"] {
  if (checks.length === 0) {
    return {
      status: "unknown",
      message: "No live health check is configured.",
      checkedAt: null,
      checks,
    };
  }
  const checkedAt =
    checks
      .map((check) => check.checkedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  if (checks.some((check) => check.status === "down")) {
    return {
      status: "critical",
      message: "One or more health checks failed.",
      checkedAt,
      checks,
    };
  }
  if (checks.some((check) => check.status === "degraded")) {
    return {
      status: "warning",
      message: "One or more health checks are degraded.",
      checkedAt,
      checks,
    };
  }
  if (
    checks.some(
      (check) => check.status === "unconfigured" || check.status === "unknown",
    )
  ) {
    return {
      status: "unknown",
      message: "One or more health checks are unverified.",
      checkedAt,
      checks,
    };
  }
  return {
    status: "healthy",
    message: "All health checks passed.",
    checkedAt,
    checks,
  };
}

function normalizeHealthCheck(
  service: ExecutiveServiceHealth | undefined,
): OperationalHealthCheck[] {
  if (!service) return [];
  return [
    {
      id: service.id,
      name: service.service,
      status: service.status,
      message: service.message,
      checkedAt: service.checkedAt,
    },
  ];
}

function aggregateCloudflareHealth(
  health: ExecutiveHealthSnapshot,
): OperationalServiceRow["health"] {
  const children = ["cloudflare-turnstile", "cloudflare-origin"].map((id) =>
    health.services.find((service) => service.id === id),
  );
  const checks: OperationalHealthCheck[] = children.map((service, index) => ({
    id: service?.id ?? ["cloudflare-turnstile", "cloudflare-origin"][index]!,
    name: index === 0 ? "Turnstile" : "Origin protection",
    status: service?.status ?? "unknown",
    message: service?.message ?? "Cloudflare check was not returned.",
    checkedAt: service?.checkedAt ?? null,
  }));
  return healthStatus(checks);
}

function overallHealth(rows: OperationalServiceRow[]): OperationalHealthStatus {
  if (rows.some((row) => row.health.status === "critical")) return "critical";
  if (rows.some((row) => row.health.status === "warning")) return "warning";
  if (rows.some((row) => row.health.status === "unknown")) return "unknown";
  return "healthy";
}

export type MeteredUsage = {
  state: UsageState;
  message?: string | null;
  primary?: UsageMetric | null;
  secondary?: UsageMetric | null;
  additional?: UsageMetric[];
};

function toUsage(value: MeteredUsage): OperationalServiceRow["usage"] {
  return {
    state: value.state,
    message: value.message ?? null,
    primary: value.primary ?? null,
    secondary: value.secondary ?? null,
    additional: value.additional ?? [],
  };
}

function providerConfigured(...values: Array<string | undefined>): boolean {
  return values.every((value) => Boolean(value?.trim()));
}

function providerConfigurationState(
  ...values: Array<string | undefined>
): "absent" | "complete" | "partial" {
  const configured = values.filter((value) => Boolean(value?.trim())).length;
  if (configured === 0) return "absent";
  return configured === values.length ? "complete" : "partial";
}

type QueryResult = { count: number | null; error: { message: string } | null };
type UsageClient = ReturnType<typeof createServiceClient>;

async function countRows(request: PromiseLike<QueryResult>): Promise<number> {
  const result = await request;
  if (result.error) throw new Error(result.error.message);
  return result.count ?? 0;
}

async function loadAuditUsage(
  provider: "serper" | "resend",
  window: UsageWindow,
  supabase: UsageClient,
): Promise<number> {
  return countRows(
    supabase
      .from("external_call_audit_spans")
      .select("span_id", { count: "exact", head: true })
      .eq("provider", provider)
      .eq("terminal_status", "succeeded")
      .gte("started_at", window.start)
      .lt("started_at", window.end),
  );
}

function parsedPostHogCount(result: {
  columns: string[];
  results: unknown[][];
}): number {
  const index = result.columns.findIndex((column) =>
    ["events", "count", "event_count"].includes(column),
  );
  const value = result.results[0]?.[index >= 0 ? index : 0];
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(count) || count < 0)
    throw new Error("PostHog returned an invalid event count.");
  return count;
}

export function parseUpstashDatabase(value: unknown): {
  requestLimit: number | null;
  storageLimit: number | null;
  plan: string | null;
} {
  const database = Array.isArray(value) ? value[0] : value;
  if (!database || typeof database !== "object")
    throw new Error("Upstash database response was malformed.");
  const row = database as Record<string, unknown>;
  const numberOrNull = (candidate: unknown): number | null => {
    const number =
      typeof candidate === "number" ? candidate : Number(candidate);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  return {
    requestLimit: numberOrNull(
      row.db_request_limit ?? row.max_commands_per_month,
    ),
    storageLimit: numberOrNull(row.db_disk_threshold ?? row.max_storage),
    plan: typeof row.type === "string" ? row.type : null,
  };
}

function latestPointTimestamp(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const timestamps = value.flatMap((point) => {
    if (!point || typeof point !== "object") return [];
    const x = (point as Record<string, unknown>).x;
    return typeof x === "string" && Number.isFinite(Date.parse(x)) ? [x] : [];
  });
  return timestamps.sort().at(-1) ?? null;
}

export function parseUpstashStats(value: unknown): {
  monthlyCommands: number;
  todayCommands: number;
  storage: number | null;
  bandwidth: number | null;
  freshness: string | null;
} {
  if (!value || typeof value !== "object")
    throw new Error("Upstash stats response was malformed.");
  const row = value as Record<string, unknown>;
  const requiredCommandTotal = (candidate: unknown): number => {
    const number =
      typeof candidate === "number"
        ? candidate
        : typeof candidate === "string" && candidate.trim() !== ""
          ? Number(candidate)
          : Number.NaN;
    if (!Number.isFinite(number) || number < 0) {
      throw new Error(
        "Upstash stats response is missing a valid monthly or daily command total.",
      );
    }
    return number;
  };
  const monthlyCommands = requiredCommandTotal(row.total_monthly_requests);
  const todayCommands = requiredCommandTotal(row.daily_net_commands);
  const storageCandidate = Number(
    row.current_storage ?? row.total_monthly_storage,
  );
  const storage =
    Number.isFinite(storageCandidate) && storageCandidate >= 0
      ? storageCandidate
      : null;
  const bandwidthCandidate = Number(row.total_monthly_bandwidth);
  const freshness =
    typeof row.updated_at === "string"
      ? row.updated_at
      : (latestPointTimestamp(row.throughput) ??
        latestPointTimestamp(
          row.command_counts && Array.isArray(row.command_counts)
            ? row.command_counts.flatMap((metric) =>
                metric && typeof metric === "object"
                  ? (metric as Record<string, unknown>).data_points
                  : [],
              )
            : [],
        ));
  return {
    monthlyCommands,
    todayCommands,
    storage,
    bandwidth:
      Number.isFinite(bandwidthCandidate) && bandwidthCandidate >= 0
        ? bandwidthCandidate
        : null,
    freshness,
  };
}

async function auditedJson(
  url: string,
  init: RequestInit,
  provider: "upstash" | "sentry" | "railway",
  operation: "get_database" | "get_stats" | "get_error_events" | "get_metrics",
  fetchImpl: typeof fetch,
  // Providers that answer a failure with HTTP 200 (Railway GraphQL) pass a
  // classifier so the span is recorded as failed instead of succeeded.
  classify?: (body: unknown) => AuditStatus,
): Promise<unknown> {
  const parsedUrl = new URL(url);
  const auditPath =
    provider === "upstash"
      ? parsedUrl.pathname.replace(/\/[^/]+$/, "/:database-id")
      : parsedUrl.pathname;
  return auditedCall(
    {
      provider,
      operation,
      kind: "external",
      meta: {
        endpoint: parsedUrl.origin + auditPath,
        method: init.method ?? "GET",
      },
    },
    async (context) => {
      const response = await fetchImpl(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(8_000),
      });
      context.summary.httpStatus = response.status;
      const providerName = {
        upstash: "Upstash",
        sentry: "Sentry",
        railway: "Railway",
      }[provider];
      if (!response.ok)
        throw new Error(`${providerName} returned HTTP ${response.status}.`);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        context.summary.malformed = true;
        throw new Error(`${providerName} returned malformed JSON.`);
      }
      context.summary.response =
        body && typeof body === "object"
          ? { keys: Object.keys(body).slice(0, 20) }
          : { type: typeof body };
      return body;
    },
    classify ? { classify } : {},
  );
}

export type UpstashUsageOptions = {
  email: string;
  apiKey: string;
  databaseId: string;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export async function fetchUpstashUsage({
  email,
  apiKey,
  databaseId,
  fetchImpl = globalThis.fetch,
  now = new Date(),
}: UpstashUsageOptions): Promise<MeteredUsage> {
  const cacheKey = `${email}\u0000${databaseId}`;
  const cached = upstashUsageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const authorization = `Basic ${Buffer.from(`${email}:${apiKey}`).toString("base64")}`;
  const init = {
    headers: { Authorization: authorization, Accept: "application/json" },
  };
  const [databaseResponse, statsResponse] = await Promise.all([
    auditedJson(
      `https://api.upstash.com/v2/redis/database/${encodeURIComponent(databaseId)}`,
      init,
      "upstash",
      "get_database",
      fetchImpl,
    ),
    auditedJson(
      `https://api.upstash.com/v2/redis/stats/${encodeURIComponent(databaseId)}`,
      init,
      "upstash",
      "get_stats",
      fetchImpl,
    ),
  ]);
  const database = parseUpstashDatabase(databaseResponse);
  const stats = parseUpstashStats(statsResponse);
  const month = utcMonthWindow(now);
  const today = utcDayWindow(now);
  const primary = createMetric({
    value: stats.monthlyCommands,
    unit: "commands",
    limit: database.requestLimit,
    window: month,
    source: "Upstash Management API",
    freshness: stats.freshness,
    at: now,
  });
  const secondary = createMetric({
    value: stats.todayCommands,
    unit: "commands today",
    limit: null,
    window: today,
    source: "Upstash Management API",
    freshness: stats.freshness,
    at: now,
  });
  const additional: UsageMetric[] = [];
  if (stats.storage !== null && database.storageLimit !== null) {
    additional.push(
      createMetric({
        value: stats.storage,
        unit: "bytes",
        limit: database.storageLimit,
        window: month,
        source: "Upstash Management API",
        freshness: stats.freshness,
        projection: null,
        at: now,
      }),
    );
  }
  const usage = { state: "ready" as const, primary, secondary, additional };
  upstashUsageCache.set(cacheKey, {
    value: usage,
    expiresAt: Date.now() + OPERATIONAL_CACHE_TTL_MS,
  });
  return usage;
}

const RAILWAY_GRAPHQL_ENDPOINT = "https://backboard.railway.com/graphql/v2";
// Service ids identify services inside the Railway project; they are not
// secrets and never appear in a header, so they stay in source.
export const RAILWAY_SERVICE_IDS = [
  "c26be870-d329-4720-b075-eab280842478",
  "b85503a7-83b4-46cb-85e3-7aae5426a435",
] as const;
// Shortcut: the metered service set is pinned by hand. Ceiling - a service
// added to, or recreated in, the Railway project mints a new id and silently
// drops out of the sum while the meter still reports `exact`. Upgrade path:
// list the project's services through the same GraphQL endpoint and meter
// whatever comes back. The guard until then is the "meters every Railway
// service in the registry" case in `operational-usage.test.ts`, which fails
// when the registry's Railway service count and this list disagree.
//
// The project and environment ids are pinned in source for the same reason as
// the service ids: they are not secrets, they never appear in a header, and
// reading them from the environment would collide with the values Railway
// injects into a deployed service (which name the *deployed* environment, not
// the one this meter is supposed to read).
const RAILWAY_PROJECT_ID = "fc1fb53f-6a7f-4324-8275-de1ec53847eb";
const RAILWAY_ENVIRONMENT_ID = "d2c107d8-95e4-4467-a972-fbf719593dc3";
// Both metered services bill against ONE project egress allowance, so this
// limit is compared against their sum.
const RAILWAY_EGRESS_LIMIT_GB = 5;
// PER SERVICE, deliberately unlike the summed egress limit directly above.
// 1.5 GB is what a single Railway service is expected to stay under, so each
// service's 7-day mean is assessed against it on its own and the worst one is
// published. Summing the two means instead put two healthy services (0.9 +
// 0.8) at ratio 1.13 and paged critical every single day, which trains the
// reader to ignore the alarm this meter exists to raise.
const RAILWAY_MEMORY_LIMIT_GB = 1.5;
const RAILWAY_METRICS_QUERY = `query($p:String!,$e:String!,$s:String!,$st:DateTime!,$en:DateTime!){
  metrics(projectId:$p, environmentId:$e, serviceId:$s,
          measurements:[NETWORK_TX_GB, MEMORY_USAGE_GB],
          startDate:$st, endDate:$en, sampleRateSeconds:86400)
  { measurement values { ts value } } }`;

type RailwaySeries = {
  measurement: string;
  values: Array<{ ts: string; value: number }>;
};

function parseRailwayMetrics(value: unknown): RailwaySeries[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Railway metrics response was malformed.");
  const root = value as Record<string, unknown>;
  if (Array.isArray(root.errors) && root.errors.length > 0) {
    const messages = root.errors
      .map((entry) =>
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>).message
          : null,
      )
      .filter((message): message is string => typeof message === "string");
    throw new Error(
      `Railway metrics API returned an error: ${messages.join("; ") || "unknown error"}`,
    );
  }
  const data = root.data;
  const metrics =
    data && typeof data === "object"
      ? (data as Record<string, unknown>).metrics
      : undefined;
  if (!Array.isArray(metrics))
    throw new Error("Railway metrics response was malformed.");
  return metrics.flatMap((series) => {
    if (!series || typeof series !== "object") return [];
    const row = series as Record<string, unknown>;
    if (typeof row.measurement !== "string" || !Array.isArray(row.values))
      return [];
    const values = row.values.flatMap((point) => {
      if (!point || typeof point !== "object") return [];
      const sample = point as Record<string, unknown>;
      // A gap in the series arrives as `null` (and, historically, as `""` or
      // `false`). `Number()` turns all three into a finite 0, which would be
      // recorded as a real zero-egress reading, so non-numeric samples are
      // dropped instead of coerced.
      const raw = sample.value;
      const number =
        typeof raw === "number"
          ? raw
          : typeof raw === "string" && raw.trim() !== ""
            ? Number(raw)
            : Number.NaN;
      return typeof sample.ts === "string" && Number.isFinite(number)
        ? [{ ts: sample.ts, value: number }]
        : [];
    });
    return [{ measurement: row.measurement, values }];
  });
}

function railwaySamples(
  series: RailwaySeries[],
  measurement: string,
): Array<{ ts: string; value: number }> {
  return series
    .filter((entry) => entry.measurement === measurement)
    .flatMap((entry) => entry.values);
}

// The matched sample count is returned alongside the sum so the caller can
// tell "no data" (renamed measurement, empty series, expired scope) from "a
// quiet day": Railway emits a bucket with value 0 for a genuinely idle day, so
// zero *samples* is never a real zero reading.
function railwayEgressGb(
  series: RailwaySeries[],
  window: UsageWindow,
): { gb: number; samples: number } {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  // Assumption, unpinned: Railway stamps each daily bucket at its START, so a
  // half-open [start, end) filter keeps yesterday's bucket. If Railway stamps
  // at the bucket END this excludes yesterday and the meter reads no-data
  // forever. Verify by comparing one day's figure here against the same day on
  // the Railway dashboard (Project -> Usage -> Network egress).
  const matched = railwaySamples(series, "NETWORK_TX_GB").filter((sample) => {
    const at = Date.parse(sample.ts);
    return Number.isFinite(at) && at >= start && at < end;
  });
  return {
    gb: matched.reduce((sum, sample) => sum + sample.value, 0),
    samples: matched.length,
  };
}

// `null` when the series carried no memory samples at all, for the same reason
// egress retains its count: a mean over zero samples is unknown, not 0.
function railwayMemoryMeanGb(series: RailwaySeries[]): number | null {
  const samples = railwaySamples(series, "MEMORY_USAGE_GB");
  if (samples.length === 0) return null;
  return (
    samples.reduce((sum, sample) => sum + sample.value, 0) / samples.length
  );
}

const RAILWAY_UNAVAILABLE_MESSAGE = "Railway metrics request failed.";
const RAILWAY_NO_EGRESS_SAMPLES_MESSAGE =
  "Railway metrics returned no egress samples for the reported day - the figure is unknown, not zero.";

// Railway reports an unauthorized or malformed query with HTTP 200 and an
// `errors` array, so without this the span records a succeeded call at the same
// moment every report says the meter is unavailable.
function railwayAuditStatus(body: unknown): AuditStatus {
  if (!body || typeof body !== "object") return "failed";
  const errors = (body as Record<string, unknown>).errors;
  return Array.isArray(errors) && errors.length > 0 ? "failed" : "succeeded";
}

export type RailwayUsageOptions = {
  apiToken: string;
  projectId: string;
  environmentId: string;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export async function fetchRailwayUsage({
  apiToken,
  projectId,
  environmentId,
  fetchImpl = globalThis.fetch,
  now = new Date(),
}: RailwayUsageOptions): Promise<MeteredUsage> {
  const cacheKey = `${projectId}\u0000${environmentId}`;
  const cached = railwayUsageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const yesterday = new Date(now.getTime() - DAY_MS);
  const day = utcDayWindow(yesterday);
  const memoryWindow = utcTrailingDaysWindow(yesterday, 7);
  let series: RailwaySeries[][];
  try {
    series = await Promise.all(
      RAILWAY_SERVICE_IDS.map(async (serviceId) =>
        parseRailwayMetrics(
          await auditedJson(
            RAILWAY_GRAPHQL_ENDPOINT,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
                "User-Agent": "formoria-spend-watch",
              },
              body: JSON.stringify({
                query: RAILWAY_METRICS_QUERY,
                variables: {
                  p: projectId,
                  e: environmentId,
                  s: serviceId,
                  st: memoryWindow.start,
                  en: memoryWindow.end,
                },
              }),
            },
            "railway",
            "get_metrics",
            fetchImpl,
            railwayAuditStatus,
          ),
        ),
      ),
    );
  } catch {
    // Railway answers an unauthorized or malformed query with HTTP 200 and an
    // `errors` array, so the failure is surfaced as an unavailable meter rather
    // than a zero-egress reading. The provider text is deliberately not copied
    // into the message -- the same contract every sibling meter follows, since
    // this string reaches the operational snapshot, the cron JSON, and Slack.
    // The raw message is still recorded on the audit span. Errors are never
    // cached; the next report retries.
    return { state: "error", message: RAILWAY_UNAVAILABLE_MESSAGE };
  }
  // Both Railway services bill against the same project egress allowance, so
  // the worker's egress is folded into this one meter.
  const egressReadings = series.map((entry) => railwayEgressGb(entry, day));
  const egress = egressReadings.reduce((sum, entry) => sum + entry.gb, 0);
  const egressSamples = egressReadings.reduce(
    (sum, entry) => sum + entry.samples,
    0,
  );
  // A zero-sample result must never be publishable as `0.00 GB` at `exact` and
  // `normal` -- that is a false green on the alarm this meter exists to be.
  if (egressSamples === 0) {
    return { state: "error", message: RAILWAY_NO_EGRESS_SAMPLES_MESSAGE };
  }
  // Memory is assessed per service (see RAILWAY_MEMORY_LIMIT_GB) and the worst
  // service is published as the secondary metric. Every service shares one
  // limit, so the highest mean is also the highest ratio.
  const memoryByService: Array<{ serviceId: string; mean: number }> = [];
  RAILWAY_SERVICE_IDS.forEach((serviceId, index) => {
    const mean = railwayMemoryMeanGb(series[index] ?? []);
    if (mean !== null) memoryByService.push({ serviceId, mean });
  });
  // A service that reported no samples is not assessed rather than counted as
  // 0 GB -- a missing service must never read as healthy. When SOME services
  // reported, the worst of those is still published (an over-limit service is
  // actionable now) and the reporting count travels in `source` so a partial
  // reading is never mistaken for full coverage. Only when NO service reported
  // is the metric omitted entirely.
  const worstMemory = memoryByService.reduce<{
    serviceId: string;
    mean: number;
  } | null>(
    (worst, entry) => (worst === null || entry.mean > worst.mean ? entry : worst),
    null,
  );
  const usage: MeteredUsage = {
    state: "ready",
    message:
      "Daily granularity - the Railway dashboard usage limit is the intra-day stop.",
    primary: createMetric({
      value: egress,
      unit: "GB",
      limit: RAILWAY_EGRESS_LIMIT_GB,
      window: day,
      source: "Railway metrics API",
      completeness: "exact",
      projection: null,
      at: now,
    }),
    // Omitted rather than published as 0.00 GB when Railway returned no memory
    // samples at all: an unknown reading must never render as a healthy one.
    secondary:
      worstMemory === null
        ? null
        : createMetric({
            value: worstMemory.mean,
            unit: "GB",
            limit: RAILWAY_MEMORY_LIMIT_GB,
            window: memoryWindow,
            subject: `service ${worstMemory.serviceId}`,
            source: `Railway metrics API (worst of ${memoryByService.length}/${RAILWAY_SERVICE_IDS.length} services reporting)`,
            completeness: "exact",
            projection: null,
            at: now,
          }),
  };
  railwayUsageCache.set(cacheKey, {
    value: usage,
    expiresAt: Date.now() + OPERATIONAL_CACHE_TTL_MS,
  });
  return usage;
}

async function fetchSentryErrorUsage(
  now: Date,
  fetchImpl: typeof fetch,
): Promise<MeteredUsage> {
  const baseUrl = process.env.SENTRY_BASE_URL?.trim().replace(/\/+$/, "");
  const organization = process.env.SENTRY_ORGANIZATION?.trim();
  const token = (
    process.env.SENTRY_READ_TOKEN ?? process.env.SENTRY_AUTH_TOKEN
  )?.trim();
  if (!providerConfigured(baseUrl, organization, token)) {
    return {
      state: "unconfigured",
      message: "Sentry stats monitoring is not configured.",
    };
  }
  const window = utcMonthWindow(now);
  const url = new URL(
    `${baseUrl}/api/0/organizations/${encodeURIComponent(organization!)}/stats_v2/`,
  );
  url.searchParams.set("start", window.start);
  url.searchParams.set("end", window.end);
  url.searchParams.set("field", "sum(quantity)");
  url.searchParams.set("category", "error");
  url.searchParams.set("outcome", "accepted");
  const body = await auditedJson(
    url.toString(),
    {
      headers: { Authorization: `Bearer ${token}` },
    },
    "sentry",
    "get_error_events",
    fetchImpl,
  );
  const count = parseSentryAcceptedCount(body);
  return {
    state: "ready",
    primary: createMetric({
      value: count,
      unit: "accepted error events",
      limit: null,
      window,
      source: "Sentry stats_v2",
      at: now,
    }),
  };
}

export function parseSentryAcceptedCount(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Sentry stats response was malformed.");
  }
  const groups = (value as Record<string, unknown>).groups;
  if (!Array.isArray(groups))
    throw new Error("Sentry stats response was malformed.");
  let validTotals = 0;
  const total = groups.reduce((sum, group) => {
    if (!group || typeof group !== "object") return sum;
    const totals = (group as Record<string, unknown>).totals;
    if (!totals || typeof totals !== "object") return sum;
    const count = Number((totals as Record<string, unknown>)["sum(quantity)"]);
    if (!Number.isFinite(count) || count < 0) return sum;
    validTotals += 1;
    return sum + count;
  }, 0);
  if (validTotals === 0 || !Number.isFinite(total)) {
    throw new Error(
      "Sentry stats response did not contain an accepted error total.",
    );
  }
  return total;
}

type OperationalDependencies = {
  now?: Date;
  health?: Promise<ExecutiveHealthSnapshot>;
  spend?: Promise<SpendSnapshotV1>;
  supabase?: UsageClient | null;
  fetchImpl?: typeof fetch;
  posthog?: PostHogQueryClient | null;
};

async function collectMeteredUsage(
  now: Date,
  supabase: UsageClient | null,
  fetchImpl: typeof fetch,
  posthog: PostHogQueryClient | null,
  spend: Promise<SpendSnapshotV1> | null,
): Promise<Map<string, MeteredUsage>> {
  const month = utcMonthWindow(now);
  const tasks = [
    {
      id: "openai",
      promise: providerConfigured(process.env.OPENAI_API_KEY)
        ? (
            spend ??
            Promise.reject(new Error("OpenAI spend meter is unavailable."))
          ).then((snapshot) => {
            const line = snapshot.services.find(
              (service) => service.id === "openai",
            );
            if (!line || line.units === null || line.amountUsd === null)
              throw new Error("OpenAI spend meter returned no measured data.");
            const primary = createMetric({
              value: line.amountUsd,
              unit: "USD",
              limit: 25,
              window:
                snapshot.cycles.find((cycle) => cycle.resetsOnDay === 1) ??
                month,
              source: "Formoria brand_ai_results",
              at: now,
            });
            const secondary = createMetric({
              value: line.units,
              unit: "tokens",
              limit: null,
              window: primary.window,
              source: "Formoria brand_ai_results",
              at: now,
            });
            return {
              id: "openai",
              state: "ready" as const,
              primary,
              secondary,
            };
          })
        : Promise.resolve({
            id: "openai",
            state: "unconfigured" as const,
            message: "OpenAI usage requires OPENAI_API_KEY.",
          }),
    },
    {
      id: "serper",
      promise: providerConfigured(process.env.SERPER_API_KEY)
        ? (supabase
            ? loadAuditUsage("serper", month, supabase)
            : Promise.reject(new Error("Supabase usage meter is unavailable."))
          ).then((value) => ({
            id: "serper",
            state: "ready" as const,
            primary: createMetric({
              value,
              unit: "successful credits",
              limit: null,
              window: month,
              source: "Formoria audit spans",
              at: now,
            }),
          }))
        : Promise.resolve({
            id: "serper",
            state: "unconfigured" as const,
            message: "Serper usage requires SERPER_API_KEY.",
          }),
    },
    {
      // Known ceiling: Serper and Resend both meter off `external_call_audit_spans`.
      // A per-provider query failure stays isolated to its own row, but a
      // table-level outage degrades both rows at once. Acceptable while the audit
      // spans are the only send meter; split the source if the rows must fail
      // independently.
      id: "resend",
      promise: supabase
        ? loadAuditUsage("resend", month, supabase).then((value) => ({
            id: "resend",
            state: "ready" as const,
            primary: createMetric({
              value,
              unit: "sends",
              limit: 3_000,
              window: month,
              source: "Formoria audit spans",
              at: now,
            }),
          }))
        : Promise.resolve({
            id: "resend",
            state: "unconfigured" as const,
            message: "Resend usage requires the Supabase audit-span meter.",
          }),
    },
    {
      id: "upstash-redis",
      promise:
        providerConfigurationState(
          process.env.UPSTASH_API_EMAIL,
          process.env.UPSTASH_API_KEY,
          process.env.UPSTASH_REDIS_DATABASE_ID,
        ) === "complete"
          ? fetchUpstashUsage({
              email: process.env.UPSTASH_API_EMAIL!,
              apiKey: process.env.UPSTASH_API_KEY!,
              databaseId: process.env.UPSTASH_REDIS_DATABASE_ID!,
              fetchImpl,
              now,
            }).then((usage) => ({ id: "upstash-redis", ...usage }))
          : providerConfigurationState(
                process.env.UPSTASH_API_EMAIL,
                process.env.UPSTASH_API_KEY,
                process.env.UPSTASH_REDIS_DATABASE_ID,
              ) === "partial"
            ? Promise.resolve({
                id: "upstash-redis",
                state: "error" as const,
                message:
                  "Upstash monitoring credentials are partially configured.",
              })
            : Promise.resolve({
                id: "upstash-redis",
                state: "unconfigured" as const,
                message: "Upstash monitoring credentials are not configured.",
              }),
    },
    {
      id: "posthog",
      promise: providerConfigured(
        process.env.POSTHOG_API_HOST,
        process.env.POSTHOG_PROJECT_ID,
        process.env.POSTHOG_PERSONAL_API_KEY,
      )
        ? (posthog
            ? posthog.run(
                "operational monthly event count",
                `SELECT count() AS events FROM events WHERE timestamp >= toDateTime('${month.start}') AND timestamp < toDateTime('${month.end}')`,
              )
            : Promise.reject(new Error("PostHog usage meter is unavailable."))
          ).then((result) => ({
            id: "posthog",
            state: "ready" as const,
            primary: createMetric({
              value: parsedPostHogCount(result),
              unit: "events",
              limit: 1_000_000,
              window: month,
              source: "PostHog HogQL",
              at: now,
            }),
          }))
        : Promise.resolve({
            id: "posthog",
            state: "unconfigured" as const,
            message: "PostHog event monitoring is not configured.",
          }),
    },
    {
      id: "railway-formoria",
      // The project, environment, and service ids live in source, so the token
      // is the only configuration this meter reads and a missing token is
      // `unconfigured`, never a failed report.
      promise: providerConfigured(process.env.RAILWAY_API_TOKEN)
        ? fetchRailwayUsage({
            apiToken: process.env.RAILWAY_API_TOKEN!,
            projectId: RAILWAY_PROJECT_ID,
            environmentId: RAILWAY_ENVIRONMENT_ID,
            fetchImpl,
            now,
          }).then((usage) => ({ id: "railway-formoria", ...usage }))
        : Promise.resolve({
            id: "railway-formoria",
            state: "unconfigured" as const,
            message: "Railway usage requires RAILWAY_API_TOKEN.",
          }),
    },
    {
      id: "sentry",
      promise: fetchSentryErrorUsage(now, fetchImpl).then((usage) => ({
        id: "sentry",
        ...usage,
      })),
    },
  ];
  const outputs = await Promise.allSettled(tasks.map((task) => task.promise));
  const map = new Map<string, MeteredUsage>();
  for (const [index, output] of outputs.entries()) {
    const task = tasks[index]!;
    if (output.status === "fulfilled") {
      const { id, ...usage } = output.value;
      map.set(id, usage);
    } else {
      // The provider name is deliberately not copied from an exception; provider
      // errors are surfaced as an unavailable meter without leaking credentials.
      map.set(task.id, {
        state: "error",
        message: "Usage provider request failed.",
      });
    }
  }
  return map;
}

function usageForEntry(
  entry: ServiceEntry,
  meters: Map<string, MeteredUsage>,
): OperationalServiceRow["usage"] {
  // The curation worker's egress and memory are summed into the Railway
  // project meter, so a second Railway row would double-count the same project
  // allowance. The row says so rather than reading "Dashboard only", which
  // would send an operator chasing an unmetered service.
  if (entry.id === "railway-curation-worker") {
    return emptyUsage(
      "unsupported",
      "Metered on the Railway project row - this worker's egress and memory are included there.",
    );
  }
  if (entry.id === "supabase" || entry.id === "public-site") {
    return emptyUsage("unsupported", "Dashboard only");
  }
  if (
    [
      "openai",
      "serper",
      "resend",
      "upstash-redis",
      "posthog",
      "sentry",
      "railway-formoria",
    ].includes(entry.id)
  ) {
    return toUsage(
      meters.get(entry.id) ?? {
        state: "error",
        message: "Usage meter failed.",
      },
    );
  }
  return emptyUsage("not_applicable");
}

export function buildOperationalSnapshot({
  health,
  meters,
  now = new Date(),
  registry = SERVICE_REGISTRY,
}: {
  health: ExecutiveHealthSnapshot;
  meters?: Map<string, MeteredUsage>;
  now?: Date;
  registry?: readonly ServiceEntry[];
}): OperationalSnapshotV1 {
  const services = new Map(
    health.services.map((service) => [service.id, service]),
  );
  const visible = registry.filter((entry) => entry.operationalSection !== null);
  const cloudflareEntries = visible.filter(
    (entry) => entry.vendor === "Cloudflare",
  );
  const rows: OperationalServiceRow[] = [];
  for (const entry of visible) {
    if (cloudflareEntries.includes(entry)) continue;
    const checks = normalizeHealthCheck(services.get(entry.id));
    const healthState = healthStatus(checks);
    rows.push({
      id: entry.id,
      name: entry.name,
      service: entry.name,
      vendor: entry.vendor,
      section: entry.operationalSection!,
      plan: { kind: entry.plan.kind, sourceDate: entry.plan.asOf },
      subscription: fixedSubscription(entry),
      dashboardUrl: entry.dashboardUrl ?? null,
      health: healthState,
      usage: usageForEntry(entry, meters ?? new Map()),
    });
  }
  const cloudflare = cloudflareEntries[0];
  if (cloudflare) {
    rows.push({
      id: "cloudflare",
      name: "Cloudflare",
      service: "Cloudflare",
      vendor: "Cloudflare",
      section: cloudflare.operationalSection!,
      plan: { kind: cloudflare.plan.kind, sourceDate: cloudflare.plan.asOf },
      subscription: fixedSubscription(cloudflare),
      dashboardUrl: cloudflare.dashboardUrl ?? null,
      health: aggregateCloudflareHealth(health),
      usage: emptyUsage("not_applicable"),
    });
  }
  rows.sort(
    (left, right) =>
      left.section.localeCompare(right.section) ||
      left.name.localeCompare(right.name),
  );
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    status: overallHealth(rows),
    services: rows,
  };
}

function alertMeter(
  service: OperationalServiceRow | undefined,
  which: "primary" | "secondary" = "primary",
): OperationalAlertMeter | null {
  if (!service) return null;
  const metric = service.usage[which];
  return {
    state: service.usage.state,
    risk: metric?.risk ?? "unknown",
    value: metric?.value ?? null,
    limit: metric?.limit ?? null,
    percentage: metric?.percentage ?? null,
    projection: metric?.projection ?? null,
    message: service.usage.message,
    window: metric?.window ?? null,
    subject: metric?.subject ?? null,
  };
}

function labelledMetrics(service: OperationalServiceRow): Array<{
  label: "primary" | "secondary" | "additional";
  metric: UsageMetric;
}> {
  return [
    service.usage.primary
      ? { label: "primary" as const, metric: service.usage.primary }
      : null,
    service.usage.secondary
      ? { label: "secondary" as const, metric: service.usage.secondary }
      : null,
    ...service.usage.additional.map((metric) => ({
      label: "additional" as const,
      metric,
    })),
  ].filter(
    (
      entry,
    ): entry is {
      label: "primary" | "secondary" | "additional";
      metric: UsageMetric;
    } => entry !== null,
  );
}

function meterReading(metric: UsageMetric): string {
  const value = metric.value === null ? "unknown" : String(metric.value);
  const limit = metric.limit === null ? "no limit" : String(metric.limit);
  // The subject leads: "Railway ... secondary usage is critical." names the
  // project row, not the one service that is actually over its own limit.
  const subject = metric.subject === null ? "" : `${metric.subject}: `;
  return `${subject}${value} of ${limit} ${metric.unit}.`;
}

export function buildOperationalAlertSummary(
  snapshot: OperationalSnapshotV1,
): OperationalAlertSummary {
  const byId = new Map(
    snapshot.services.map((service) => [service.id, service]),
  );
  const warnings = snapshot.services.flatMap((service) => {
    return labelledMetrics(service)
      .filter(({ metric }) => ["warning", "critical"].includes(metric.risk))
      .map(
        ({ label, metric }) =>
          `${service.name} ${label === "primary" ? "" : `${label} `}usage is ${metric.risk}.` +
          // "secondary usage is warning." names neither the quantity nor the
          // amount, and a reader assumes it means the primary metric. Non-
          // primary warnings carry their reading so they are diagnosable.
          (label === "primary" ? "" : ` ${meterReading(metric)}`),
      );
  });
  const lowerBoundCaveats = snapshot.services.flatMap((service) =>
    labelledMetrics(service)
      .filter(({ metric }) => metric.completeness === "lower_bound")
      .map(
        ({ label }) =>
          `${service.name} ${label === "primary" ? "" : `${label} `}usage is a lower bound from local measurements.`,
      ),
  );
  const upstash = alertMeter(byId.get("upstash-redis"));
  const railwayService = byId.get("railway-formoria");
  const railway = alertMeter(railwayService);
  const unavailableUpstash = meterUnavailable(upstash, {
    escalateUnconfigured: true,
  });
  // `unconfigured` does NOT escalate for Railway: the token is set by hand
  // after this ships, so escalating absence would page daily until then. An
  // `error` -- a rotated or expired token, a renamed measurement, an empty
  // series -- always escalates, because a silently dead egress alarm is the
  // failure this meter exists to prevent.
  const unavailableRailway = meterUnavailable(railway, {
    escalateUnconfigured: false,
  });
  return {
    needsAttention:
      warnings.length > 0 || unavailableUpstash || unavailableRailway,
    unavailableUpstash,
    unavailableRailway,
    warnings,
    lowerBoundCaveats,
    openai: alertMeter(byId.get("openai")),
    upstash,
    posthog: alertMeter(byId.get("posthog")),
    railway,
    // The memory metric rides `usage.secondary`, which `alertMeter` would
    // otherwise drop -- leaving a memory warning with no value, unit, or limit
    // anywhere in the digest.
    railwayMemory: railwayService?.usage.secondary
      ? alertMeter(railwayService, "secondary")
      : null,
  };
}

function meterUnavailable(
  meter: OperationalAlertMeter | null,
  { escalateUnconfigured }: { escalateUnconfigured: boolean },
): boolean {
  if (meter === null) return true;
  return escalateUnconfigured
    ? ["error", "unconfigured"].includes(meter.state)
    : meter.state === "error";
}

const OPERATIONAL_CACHE_TTL_MS = 5 * 60_000;
const upstashUsageCache = new Map<
  string,
  { value: MeteredUsage; expiresAt: number }
>();
const railwayUsageCache = new Map<
  string,
  { value: MeteredUsage; expiresAt: number }
>();

export async function loadOperationalSnapshot(
  dependencies: OperationalDependencies = {},
): Promise<OperationalSnapshotV1> {
  const now = dependencies.now ?? new Date();
  const health = await (dependencies.health ?? getExecutiveHealth()).catch(
    (): ExecutiveHealthSnapshot => ({
      status: "critical",
      checkedAt: now.toISOString(),
      services: [],
      inventory: [],
    }),
  );
  const spend =
    dependencies.spend ??
    (providerConfigured(process.env.OPENAI_API_KEY)
      ? getSpendSnapshot()
      : null);
  const needsSupabase = true;
  const supabase =
    dependencies.supabase ??
    (needsSupabase &&
    providerConfigured(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
      ? createServiceClient()
      : null);
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const needsPostHog = providerConfigured(
    process.env.POSTHOG_API_HOST,
    process.env.POSTHOG_PROJECT_ID,
    process.env.POSTHOG_PERSONAL_API_KEY,
  );
  const posthog =
    dependencies.posthog ?? (needsPostHog ? createPostHogQueryClient() : null);
  let meters: Map<string, MeteredUsage>;
  try {
    meters = await collectMeteredUsage(
      now,
      supabase,
      fetchImpl,
      posthog,
      spend,
    );
  } catch {
    meters = new Map([
      ["unknown", { state: "error", message: "Usage meter failed." }],
    ]);
  }
  return buildOperationalSnapshot({ health, meters, now });
}

function createOperationalSnapshotCache({
  load = loadOperationalSnapshot,
  now = Date.now,
}: {
  load?: () => Promise<OperationalSnapshotV1>;
  now?: () => number;
} = {}) {
  let cache: { value: OperationalSnapshotV1; expiresAt: number } | null = null;
  async function refresh(): Promise<OperationalSnapshotV1> {
    const value = await load();
    cache = { value, expiresAt: now() + OPERATIONAL_CACHE_TTL_MS };
    return value;
  }
  async function get(): Promise<OperationalSnapshotV1> {
    if (cache && cache.expiresAt > now()) return cache.value;
    return refresh();
  }
  return { get, refresh };
}

const operationalSnapshotCache = createOperationalSnapshotCache();

export function getOperationalSnapshot(): Promise<OperationalSnapshotV1> {
  return operationalSnapshotCache.get();
}
