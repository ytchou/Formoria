export const HEALTH_SOURCES = ["link", "directory", "sentry"] as const;
export type HealthSource = (typeof HEALTH_SOURCES)[number];

export const HEALTH_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type HealthSeverity = (typeof HEALTH_SEVERITIES)[number];

export const MERGE_POLICIES = ["automatic", "human"] as const;
export type MergePolicy = (typeof MERGE_POLICIES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface HealthFinding {
  source: HealthSource;
  fingerprint: string;
  title: string;
  severity: HealthSeverity;
  evidence: Record<string, JsonValue>;
  mergePolicy: MergePolicy;
  humanReason?: string;
  sentryIssueId?: string;
}

export type HealthSummaryStatus = "failed" | "skipped" | "success";

export interface HealthSummaryCheck {
  findingCount: number;
  severities: Readonly<Record<HealthSeverity, number>>;
  status: HealthSummaryStatus;
}

export interface HealthFindingLifecycle {
  new: number;
  ongoing: number;
  regressed: number;
}

export interface HealthSummary {
  checks: Readonly<Record<"directory" | "link" | "sentry", HealthSummaryCheck>>;
  overallStatus: "failed" | "healthy" | "needs_attention";
  lifecycle?: HealthFindingLifecycle;
  phases: Readonly<
    Record<
      "analyze" | "collect" | "deliver" | "publish" | "repair",
      HealthSummaryStatus
    >
  >;
  repair: {
    batches?: Readonly<
      Record<
        "automatic" | "human",
        {
          findingCount: number;
          prNumber?: number;
          prUrl?: string;
          status: string;
        }
      >
    >;
    claimed?: number;
    fixed: number;
    pullRequests: number;
    queued?: number;
    unresolved: number;
  };
  ticket?: {
    identifier: string;
    url: string;
  };
}

export interface AuditRecord {
  adapter: string;
  operation: string;
  status: "success" | "failure" | "suppressed";
  latencyMs: number;
  request: Record<string, JsonValue>;
  response: Record<string, JsonValue>;
  schemaValid?: boolean;
}

export type AuditLogger = (record: AuditRecord) => void;

export function stableFingerprint(
  source: HealthSource,
  kind: string,
  identity: string,
): string {
  const normalizedKind = kind
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  const normalizedIdentity = identity.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalizedKind || !normalizedIdentity) {
    throw new Error("Fingerprint inputs must be nonempty");
  }
  return `${source}:${normalizedKind}:${normalizedIdentity}`;
}

export function requiresHumanPolicy(
  finding: Pick<HealthFinding, "source" | "mergePolicy" | "humanReason">,
): boolean {
  return finding.mergePolicy === "human" || Boolean(finding.humanReason);
}
