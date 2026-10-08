import {
  stableFingerprint,
  type HealthFinding,
  type JsonValue,
} from "./contracts";

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
  deadTuples?: number;
  liveTuples?: number;
  autovacuumThreshold?: number;
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

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
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
    recentSnapshots[1]
  ) {
    const earlierTables = new Map(
      recentSnapshots[0].tables.map((table) => [table.tableName, table]),
    );
    for (const table of [...recentSnapshots[1].tables].sort((left, right) =>
      compareText(left.tableName, right.tableName),
    )) {
      const earlier = earlierTables.get(table.tableName);
      const exceedsEffectiveThreshold = (
        candidate: DeadTupleTableEvidence,
      ): boolean =>
        typeof candidate.deadTuples === "number" &&
        Number.isFinite(candidate.deadTuples) &&
        typeof candidate.autovacuumThreshold === "number" &&
        Number.isFinite(candidate.autovacuumThreshold) &&
        candidate.deadTuples > candidate.autovacuumThreshold;
      if (
        earlier !== undefined &&
        earlier.deadTuplePercent > 20 &&
        table.deadTuplePercent > 20 &&
        exceedsEffectiveThreshold(earlier) &&
        exceedsEffectiveThreshold(table)
      ) {
        recurringDeadTupleTables.push(table.tableName);
        findings.push({
          ...humanFinding(
            "dead-tuples",
            table.tableName,
            "Dead tuples exceed 20% across the latest two snapshots",
            "high",
            {
              tableName: table.tableName,
              snapshotDates: recentSnapshots.map(
                (snapshot) => snapshot.snapshotDate,
              ),
              deadTuplePercents: [
                earlier.deadTuplePercent,
                table.deadTuplePercent,
              ],
              deadTuples: [
                earlier.deadTuples ?? null,
                table.deadTuples ?? null,
              ],
              autovacuumThresholds: [
                earlier.autovacuumThreshold ?? null,
                table.autovacuumThreshold ?? null,
              ],
            },
            "Database maintenance is human-owned",
          ),
          disposition: "report_only",
        });
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
