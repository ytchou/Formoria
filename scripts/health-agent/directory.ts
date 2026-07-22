import {
  stableFingerprint,
  type HealthFinding,
  type JsonValue,
} from "./contracts";

export interface DirectoryQuerySpec {
  id: string;
  scope: "approved_brands" | "health_telemetry" | "database_statistics";
  readOnly: true;
  sql: string;
}

export const DIRECTORY_QUERY_SPECS = {
  approvedBrandBaseline: {
    id: "approved_brand_baseline",
    scope: "approved_brands",
    readOnly: true,
    sql: `
      SELECT
        COUNT(*) AS total_approved,
        COUNT(*) FILTER (WHERE created_at >= $1::timestamptz) AS added_today,
        COUNT(*) FILTER (WHERE trim(coalesce(hero_image_url, '')) <> '') AS hero_image_count,
        COUNT(*) FILTER (WHERE length(trim(coalesce(description, ''))) >= 20) AS description_count,
        COUNT(*) FILTER (WHERE trim(coalesce(purchase_website, '')) <> '') AS purchase_website_count
      FROM brands
      WHERE status = 'approved'
    `.trim(),
  },
  approvedBrandInvariantGaps: {
    id: "approved_brand_invariant_gaps",
    scope: "approved_brands",
    readOnly: true,
    sql: `
      SELECT
        id,
        trim(coalesce(hero_image_url, '')) = '' AS missing_hero_image,
        length(trim(coalesce(description, ''))) < 20 AS description_too_short,
        approved_at IS NULL AS missing_approved_at
      FROM brands
      WHERE status = 'approved'
        AND (
          trim(coalesce(hero_image_url, '')) = ''
          OR length(trim(coalesce(description, ''))) < 20
          OR approved_at IS NULL
        )
      ORDER BY id
    `.trim(),
  },
  approvedBrandLinkTelemetry: {
    id: "approved_brand_link_telemetry",
    scope: "health_telemetry",
    readOnly: true,
    sql: `
      SELECT
        lcr.id AS record_id,
        lcr.brand_id,
        lcr.field,
        lcr.last_status_code,
        lcr.failure_dates,
        lcr.distinct_failure_days
      FROM link_check_results AS lcr
      JOIN brands AS b ON b.id = lcr.brand_id
      WHERE b.status = 'approved'
      ORDER BY lcr.id
    `.trim(),
  },
  connectionHealth: {
    id: "connection_health",
    scope: "database_statistics",
    readOnly: true,
    sql: `
      SELECT
        COUNT(*) AS total_connections,
        COUNT(*) FILTER (WHERE state = 'active') AS active_connections,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
    `.trim(),
  },
  activeQueries: {
    id: "active_queries",
    scope: "database_statistics",
    readOnly: true,
    sql: `
      SELECT pid::text AS query_id,
        EXTRACT(EPOCH FROM (now() - query_start)) AS duration_seconds
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state = 'active'
        AND pid <> pg_backend_pid()
      ORDER BY pid
    `.trim(),
  },
  deadTuples: {
    id: "dead_tuples",
    scope: "database_statistics",
    readOnly: true,
    sql: `
      SELECT relname AS table_name,
        CASE WHEN n_live_tup > 0
          THEN 100.0 * n_dead_tup / n_live_tup
          ELSE 0
        END AS dead_tuple_percent
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY relname
    `.trim(),
  },
} as const satisfies Record<string, DirectoryQuerySpec>;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function sortFindings(findings: HealthFinding[]): HealthFinding[] {
  return [...findings].sort((left, right) =>
    compareText(left.fingerprint, right.fingerprint),
  );
}

function humanFinding(
  kind: string,
  identity: string,
  title: string,
  severity: HealthFinding["severity"],
  evidence: Record<string, JsonValue>,
  humanReason: string,
): HealthFinding {
  return {
    source: "directory",
    fingerprint: stableFingerprint("directory", kind, identity),
    title,
    severity,
    evidence,
    mergePolicy: "human",
    humanReason,
  };
}

export interface ApprovedBrandInvariantGap {
  brandId: string;
  missingHeroImage: boolean;
  descriptionTooShort: boolean;
  missingApprovedAt: boolean;
}

export interface ApprovedBrandInvariantInput {
  totalApproved: number;
  addedToday: number;
  gaps: readonly ApprovedBrandInvariantGap[];
}

export interface ApprovedBrandSnapshot {
  approvedTotal: number;
  addedToday: number;
  approvalGapCount: number;
  approvalGapBrandIds: string[];
}

export function evaluateApprovedBrandInvariants(
  input: ApprovedBrandInvariantInput,
): { findings: HealthFinding[]; snapshot: ApprovedBrandSnapshot } {
  const contentGapIds = sortedUnique(
    input.gaps
      .filter((gap) => gap.missingHeroImage || gap.descriptionTooShort)
      .map((gap) => gap.brandId),
  );
  const approvalTimestampGapIds = sortedUnique(
    input.gaps.filter((gap) => gap.missingApprovedAt).map((gap) => gap.brandId),
  );
  const allGapIds = sortedUnique([
    ...contentGapIds,
    ...approvalTimestampGapIds,
  ]);
  const findings: HealthFinding[] = [];

  if (contentGapIds.length > 0) {
    findings.push(
      humanFinding(
        "approved-brand-invariant",
        "hero-image-or-description",
        "Approved brands violate content invariants",
        "high",
        {
          invariant: "hero_image_or_description",
          count: contentGapIds.length,
          brandIds: contentGapIds,
        },
        "Approval-gate leaks and brand content repair are human-owned",
      ),
    );
  }

  if (approvalTimestampGapIds.length > 0) {
    findings.push(
      humanFinding(
        "approved-brand-invariant",
        "approved-at",
        "Approved brands are missing approval timestamps",
        "high",
        {
          invariant: "approved_at",
          count: approvalTimestampGapIds.length,
          brandIds: approvalTimestampGapIds,
        },
        "Approval-gate leaks and data repair are human-owned",
      ),
    );
  }

  return {
    findings,
    snapshot: {
      addedToday: input.addedToday,
      approvedTotal: input.totalApproved,
      approvalGapBrandIds: allGapIds,
      approvalGapCount: allGapIds.length,
    },
  };
}

export type LinkTarget = "link" | "image";

export interface LinkTelemetryRecord {
  recordId: string;
  brandId: string;
  field: string;
  target: LinkTarget;
  statusCode: number | null;
  internalStorage: boolean;
  failureDates: readonly string[];
}

export interface NormalizedLinkTelemetryRecord {
  recordId: string;
  brandId: string;
  field: string;
  target: LinkTarget;
  statusCode: number | null;
  internalStorage: boolean;
  failureDates: string[];
  cleanupRequired: boolean;
}

export interface LinkTelemetrySnapshot {
  checkedCount: number;
  blockedRecordIds: string[];
  cleanupRequiredRecordIds: string[];
  records: NormalizedLinkTelemetryRecord[];
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

export function evaluateLinkTelemetry(
  records: readonly LinkTelemetryRecord[],
): { findings: HealthFinding[]; snapshot: LinkTelemetrySnapshot } {
  const normalized = records
    .map((record): NormalizedLinkTelemetryRecord => {
      const failureDates = sortedUnique(record.failureDates.filter(isIsoDate));
      const blocked = record.statusCode === 403 || record.statusCode === 429;
      const immediateInternalFailure =
        record.internalStorage &&
        (record.statusCode === 404 || record.statusCode === 410);
      return {
        recordId: record.recordId,
        brandId: record.brandId,
        field: record.field,
        target: record.target,
        statusCode: record.statusCode,
        internalStorage: record.internalStorage,
        failureDates,
        cleanupRequired:
          !blocked && (failureDates.length >= 3 || immediateInternalFailure),
      };
    })
    .sort((left, right) => compareText(left.recordId, right.recordId));

  const findings = normalized
    .filter((record) => record.cleanupRequired)
    .map((record) => {
      const immediateInternalFailure =
        record.internalStorage &&
        (record.statusCode === 404 || record.statusCode === 410);
      return humanFinding(
        "link-cleanup",
        record.recordId,
        `${record.target === "image" ? "Image" : "Link"} cleanup requires review`,
        "medium",
        {
          recordId: record.recordId,
          brandId: record.brandId,
          field: record.field,
          target: record.target,
          statusCode: record.statusCode,
          failureDates: record.failureDates,
          distinctFailureDays: record.failureDates.length,
          immediateInternalFailure,
          cleanupRequired: true,
        },
        "Link, image, and brand-field cleanup are human-owned",
      );
    });

  return {
    findings: sortFindings(findings),
    snapshot: {
      checkedCount: normalized.length,
      blockedRecordIds: normalized
        .filter(
          (record) => record.statusCode === 403 || record.statusCode === 429,
        )
        .map((record) => record.recordId),
      cleanupRequiredRecordIds: normalized
        .filter((record) => record.cleanupRequired)
        .map((record) => record.recordId),
      records: normalized,
    },
  };
}

export interface ConnectionEvidence {
  total: number;
  maximum: number;
}

export interface ActiveQueryEvidence {
  queryId: string;
  durationSeconds: number;
}

export interface DeadTupleTableEvidence {
  tableName: string;
  deadTuplePercent: number;
}

export interface DeadTupleSnapshotEvidence {
  snapshotDate: string;
  tables: readonly DeadTupleTableEvidence[];
}

export interface IndexConcernEvidence {
  concernId: string;
  tableName: string;
  queryFingerprint: string;
  indexName: string;
  planEvidence: string;
}

export interface DatabaseEvidence {
  connections: ConnectionEvidence;
  activeQueries: readonly ActiveQueryEvidence[];
  deadTupleSnapshots: readonly DeadTupleSnapshotEvidence[];
  indexConcerns: readonly IndexConcernEvidence[];
}

export interface DatabaseSnapshot {
  connectionUsagePercent: number | null;
  slowActiveQueryIds: string[];
  recurringDeadTupleTableNames: string[];
  deadTupleSnapshotDates: string[];
  evidencedIndexConcernIds: string[];
}

function consecutiveIsoDates(earlier: string, later: string): boolean {
  if (!isIsoDate(earlier) || !isIsoDate(later)) return false;
  return (
    Date.parse(`${later}T00:00:00.000Z`) -
      Date.parse(`${earlier}T00:00:00.000Z`) ===
    86_400_000
  );
}

function nonempty(value: string): boolean {
  return value.trim().length > 0;
}

export function evaluateDatabaseEvidence(evidence: DatabaseEvidence): {
  findings: HealthFinding[];
  snapshot: DatabaseSnapshot;
} {
  const findings: HealthFinding[] = [];
  const connectionUsagePercent =
    evidence.connections.maximum > 0
      ? Number(
          (
            (evidence.connections.total / evidence.connections.maximum) *
            100
          ).toFixed(2),
        )
      : null;

  if (connectionUsagePercent !== null && connectionUsagePercent > 80) {
    findings.push(
      humanFinding(
        "connection-saturation",
        "database",
        "Database connection usage exceeds 80%",
        "critical",
        {
          totalConnections: evidence.connections.total,
          maxConnections: evidence.connections.maximum,
          usagePercent: connectionUsagePercent,
        },
        "Database capacity and configuration changes are human-owned",
      ),
    );
  }

  const slowQueries = [...evidence.activeQueries]
    .filter((query) => query.durationSeconds > 60)
    .sort((left, right) => compareText(left.queryId, right.queryId));
  for (const query of slowQueries) {
    findings.push(
      humanFinding(
        "active-query",
        query.queryId,
        "Active database query exceeds 60 seconds",
        "high",
        {
          queryId: query.queryId,
          durationSeconds: query.durationSeconds,
        },
        "Database query intervention is human-owned",
      ),
    );
  }

  const snapshots = [...evidence.deadTupleSnapshots]
    .filter((snapshot) => isIsoDate(snapshot.snapshotDate))
    .sort((left, right) => compareText(left.snapshotDate, right.snapshotDate));
  const recentSnapshots = snapshots.slice(-2);
  const recurringDeadTupleTables: string[] = [];
  if (
    recentSnapshots.length === 2 &&
    recentSnapshots[0] &&
    recentSnapshots[1] &&
    consecutiveIsoDates(
      recentSnapshots[0].snapshotDate,
      recentSnapshots[1].snapshotDate,
    )
  ) {
    const earlierRates = new Map(
      recentSnapshots[0].tables.map((table) => [
        table.tableName,
        table.deadTuplePercent,
      ]),
    );
    for (const table of [...recentSnapshots[1].tables].sort((left, right) =>
      compareText(left.tableName, right.tableName),
    )) {
      const earlierRate = earlierRates.get(table.tableName);
      if (
        earlierRate !== undefined &&
        earlierRate > 20 &&
        table.deadTuplePercent > 20
      ) {
        recurringDeadTupleTables.push(table.tableName);
        findings.push(
          humanFinding(
            "dead-tuples",
            table.tableName,
            "Dead tuples exceed 20% across consecutive snapshots",
            "high",
            {
              tableName: table.tableName,
              snapshotDates: recentSnapshots.map(
                (snapshot) => snapshot.snapshotDate,
              ),
              deadTuplePercents: [earlierRate, table.deadTuplePercent],
            },
            "Database maintenance is human-owned",
          ),
        );
      }
    }
  }

  const evidencedIndexConcerns = evidence.indexConcerns
    .filter(
      (concern) =>
        nonempty(concern.concernId) &&
        nonempty(concern.tableName) &&
        nonempty(concern.queryFingerprint) &&
        nonempty(concern.indexName) &&
        nonempty(concern.planEvidence),
    )
    .sort((left, right) => compareText(left.concernId, right.concernId));
  for (const concern of evidencedIndexConcerns) {
    findings.push(
      humanFinding(
        "index-concern",
        concern.concernId,
        "Index concern has query-plan evidence",
        "high",
        {
          concernId: concern.concernId,
          tableName: concern.tableName,
          queryFingerprint: concern.queryFingerprint,
          indexName: concern.indexName,
          planEvidence: concern.planEvidence,
        },
        "Schema and index changes are human-owned",
      ),
    );
  }

  return {
    findings: sortFindings(findings),
    snapshot: {
      connectionUsagePercent,
      slowActiveQueryIds: slowQueries.map((query) => query.queryId),
      recurringDeadTupleTableNames: recurringDeadTupleTables,
      deadTupleSnapshotDates: recentSnapshots.map(
        (snapshot) => snapshot.snapshotDate,
      ),
      evidencedIndexConcernIds: evidencedIndexConcerns.map(
        (concern) => concern.concernId,
      ),
    },
  };
}

export type DependabotSeverity = "low" | "medium" | "high" | "critical";
export type VersionImpact = "patch" | "minor" | "major" | "unknown";

export interface DependabotAlertEvidence {
  alertId: string;
  packageName: string;
  severity: DependabotSeverity;
  state: "open" | "dismissed" | "fixed";
  versionImpact: VersionImpact;
}

export interface DependabotSnapshot {
  actionableAlertIds: string[];
  automaticAlertIds: string[];
  humanAlertIds: string[];
}

export function evaluateDependabotAlerts(
  alerts: readonly DependabotAlertEvidence[],
): { findings: HealthFinding[]; snapshot: DependabotSnapshot } {
  const actionable = [...alerts]
    .filter(
      (alert) =>
        alert.state === "open" &&
        (alert.severity === "critical" || alert.severity === "high"),
    )
    .sort((left, right) => compareText(left.alertId, right.alertId));

  const findings = actionable.map((alert): HealthFinding => {
    const automatic =
      alert.versionImpact === "patch" || alert.versionImpact === "minor";
    return {
      source: "directory",
      fingerprint: stableFingerprint("directory", "dependabot", alert.alertId),
      title: "High-severity dependency vulnerability",
      severity: alert.severity,
      evidence: {
        alertId: alert.alertId,
        behaviorChangeRisk: "low",
        changedFiles: ["package.json", "pnpm-lock.yaml"],
        defectKind: "dependency",
        dependencyImpact: alert.versionImpact,
        evidenceArtifactRef: `directory-health:dependabot:${alert.alertId}`,
        fixability: "high",
        packageName: alert.packageName,
        rootCauseKey: `dependabot:${alert.packageName}`,
        severity: alert.severity,
        versionImpact: alert.versionImpact,
        validationRequired: true,
      },
      mergePolicy: automatic ? "automatic" : "human",
      ...(automatic
        ? {}
        : {
            humanReason:
              alert.versionImpact === "major"
                ? "Major dependency upgrades require approval"
                : "Unknown dependency version impact requires approval",
          }),
    };
  });

  return {
    findings,
    snapshot: {
      actionableAlertIds: actionable.map((alert) => alert.alertId),
      automaticAlertIds: actionable
        .filter(
          (alert) =>
            alert.versionImpact === "patch" || alert.versionImpact === "minor",
        )
        .map((alert) => alert.alertId),
      humanAlertIds: actionable
        .filter(
          (alert) =>
            alert.versionImpact === "major" ||
            alert.versionImpact === "unknown",
        )
        .map((alert) => alert.alertId),
    },
  };
}

export interface StaleBranchEvidence {
  branchRef: string;
  observedTipSha: string;
  currentRemoteTipSha: string;
  currentMainSha: string;
  lastCommitAt: string;
  merged: boolean;
  openPullRequest: boolean;
  defaultBranch: boolean;
  protectedBranch: boolean;
  tipIsAncestorOfMain: boolean;
}

export type BranchIneligibilityReason =
  | "remote_tip_not_recorded"
  | "remote_tip_changed"
  | "main_tip_not_recorded"
  | "not_merged"
  | "tip_not_ancestor_of_main"
  | "open_pull_request"
  | "default_branch"
  | "protected_branch";

export interface StaleBranchDecision {
  branchRef: string;
  eligible: boolean;
  reasons: BranchIneligibilityReason[];
  evidence: {
    ageDays: number;
    lastCommitAt: string;
    observedTipSha: string;
    currentRemoteTipSha: string;
    currentMainSha: string;
    merged: boolean;
    tipIsAncestorOfMain: boolean;
    openPullRequest: boolean;
    defaultBranch: boolean;
    protectedBranch: boolean;
  };
}

export interface StaleBranchSnapshot {
  staleBranchRefs: string[];
  eligibleBranchRefs: string[];
  eligibleTipShas: string[];
}

const FOURTEEN_DAYS_MS = 14 * 86_400_000;

export function evaluateStaleBranches(
  branches: readonly StaleBranchEvidence[],
  nowIso: string,
): {
  findings: HealthFinding[];
  decisions: StaleBranchDecision[];
  snapshot: StaleBranchSnapshot;
} {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now))
    throw new Error("nowIso must be a valid timestamp");

  const decisions = branches
    .map((branch) => ({ branch, lastCommit: Date.parse(branch.lastCommitAt) }))
    .filter(
      ({ lastCommit }) =>
        Number.isFinite(lastCommit) && now - lastCommit > FOURTEEN_DAYS_MS,
    )
    .sort((left, right) =>
      compareText(left.branch.branchRef, right.branch.branchRef),
    )
    .map(({ branch, lastCommit }): StaleBranchDecision => {
      const reasons: BranchIneligibilityReason[] = [];
      if (!nonempty(branch.currentRemoteTipSha)) {
        reasons.push("remote_tip_not_recorded");
      } else if (branch.observedTipSha !== branch.currentRemoteTipSha) {
        reasons.push("remote_tip_changed");
      }
      if (!nonempty(branch.currentMainSha))
        reasons.push("main_tip_not_recorded");
      if (!branch.merged) reasons.push("not_merged");
      if (!branch.tipIsAncestorOfMain) reasons.push("tip_not_ancestor_of_main");
      if (branch.openPullRequest) reasons.push("open_pull_request");
      if (branch.defaultBranch) reasons.push("default_branch");
      if (branch.protectedBranch) reasons.push("protected_branch");

      return {
        branchRef: branch.branchRef,
        eligible: reasons.length === 0,
        reasons,
        evidence: {
          ageDays: Number(((now - lastCommit) / 86_400_000).toFixed(2)),
          lastCommitAt: branch.lastCommitAt,
          observedTipSha: branch.observedTipSha,
          currentRemoteTipSha: branch.currentRemoteTipSha,
          currentMainSha: branch.currentMainSha,
          merged: branch.merged,
          tipIsAncestorOfMain: branch.tipIsAncestorOfMain,
          openPullRequest: branch.openPullRequest,
          defaultBranch: branch.defaultBranch,
          protectedBranch: branch.protectedBranch,
        },
      };
    });

  const findings = decisions
    .filter((decision) => decision.eligible)
    .map((decision): HealthFinding => ({
      source: "directory",
      fingerprint: stableFingerprint(
        "directory",
        "stale-branch",
        decision.evidence.currentRemoteTipSha,
      ),
      title: "Merged stale branch is safe to remove",
      severity: "low",
      evidence: {
        branchRef: decision.branchRef,
        ...decision.evidence,
      },
      mergePolicy: "automatic",
    }));

  return {
    findings: sortFindings(findings),
    decisions,
    snapshot: {
      staleBranchRefs: decisions.map((decision) => decision.branchRef),
      eligibleBranchRefs: decisions
        .filter((decision) => decision.eligible)
        .map((decision) => decision.branchRef),
      eligibleTipShas: decisions
        .filter((decision) => decision.eligible)
        .map((decision) => decision.evidence.currentRemoteTipSha)
        .sort(compareText),
    },
  };
}

export interface DirectoryHealthInput {
  approvedBrands: ApprovedBrandInvariantInput;
  links: readonly LinkTelemetryRecord[];
  database: DatabaseEvidence;
  dependabot: readonly DependabotAlertEvidence[];
  branches: readonly StaleBranchEvidence[];
  nowIso: string;
}

export function evaluateDirectoryHealth(input: DirectoryHealthInput) {
  const approvedBrands = evaluateApprovedBrandInvariants(input.approvedBrands);
  const links = evaluateLinkTelemetry(input.links);
  const database = evaluateDatabaseEvidence(input.database);
  const dependabot = evaluateDependabotAlerts(input.dependabot);
  const branches = evaluateStaleBranches(input.branches, input.nowIso);

  return {
    findings: sortFindings([
      ...approvedBrands.findings,
      ...links.findings,
      ...database.findings,
      ...dependabot.findings,
      ...branches.findings,
    ]),
    branchDecisions: branches.decisions,
    snapshot: {
      approvedBrands: approvedBrands.snapshot,
      links: links.snapshot,
      database: database.snapshot,
      dependabot: dependabot.snapshot,
      branches: branches.snapshot,
    },
  };
}
