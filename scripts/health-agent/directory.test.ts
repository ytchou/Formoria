import { describe, expect, it } from "vitest";

import {
  evaluateApprovedBrandInvariants,
  evaluateDatabaseEvidence,
  evaluateDependabotAlerts,
} from "./directory";

describe("Directory Health policies", () => {
  it("emits compact human-owned approval-gate findings in stable order", () => {
    const result = evaluateApprovedBrandInvariants({
      totalApproved: 12,
      addedToday: 2,
      gaps: [
        {
          brandId: "brand-z",
          missingHeroImage: true,
          descriptionTooShort: false,
          missingApprovedAt: true,
        },
        {
          brandId: "brand-a",
          missingHeroImage: false,
          descriptionTooShort: true,
          missingApprovedAt: false,
        },
      ],
    });

    expect(result.findings).toHaveLength(2);
    expect(
      result.findings.every((finding) => finding.mergePolicy === "human"),
    ).toBe(true);
    expect(result.findings[0]?.evidence).toEqual({
      brandIds: ["brand-a", "brand-z"],
      count: 2,
      invariant: "hero_image_or_description",
    });
    expect(result.snapshot).toEqual({
      addedToday: 2,
      approvedTotal: 12,
      approvalGapBrandIds: ["brand-a", "brand-z"],
      approvalGapCount: 2,
    });
  });

  it("applies strict DB thresholds across the latest two dead-tuple snapshots", () => {
    const result = evaluateDatabaseEvidence({
      connections: { total: 81, maximum: 100 },
      activeQueries: [
        { queryId: "at-boundary", durationSeconds: 60 },
        { queryId: "slow", durationSeconds: 60.01 },
      ],
      deadTupleSnapshots: [
        {
          snapshotDate: "2026-07-22",
          tables: [
            {
              tableName: "brands",
              deadTuplePercent: 21,
              deadTuples: 300,
              autovacuumThreshold: 250,
            },
            { tableName: "profiles", deadTuplePercent: 20 },
          ],
        },
        {
          snapshotDate: "2026-07-21",
          tables: [
            {
              tableName: "brands",
              deadTuplePercent: 20.01,
              deadTuples: 280,
              autovacuumThreshold: 250,
            },
            {
              tableName: "profiles",
              deadTuplePercent: 25,
              deadTuples: 50,
              autovacuumThreshold: 100,
            },
          ],
        },
      ],
      indexConcerns: [
        {
          concernId: "complete",
          tableName: "brands",
          queryFingerprint: "query:approved-slug",
          indexName: "brands_slug_idx",
          planEvidence: "sequential_scan",
        },
        {
          concernId: "missing-plan",
          tableName: "brands",
          queryFingerprint: "query:search",
          indexName: "brands_name_idx",
          planEvidence: "",
        },
      ],
    });

    expect(result.findings.map((finding) => finding.fingerprint)).toEqual([
      "directory:active-query:slow",
      "directory:connection-saturation:database",
      "directory:dead-tuples:brands",
      "directory:index-concern:complete",
    ]);
    expect(
      result.findings.find((finding) =>
        finding.fingerprint.endsWith("dead-tuples:brands"),
      ),
    ).toMatchObject({ disposition: "report_only" });
    expect(
      result.findings.every((finding) => finding.mergePolicy === "human"),
    ).toBe(true);
    expect(result.snapshot.deadTupleSnapshotDates).toEqual([
      "2026-07-21",
      "2026-07-22",
    ]);
  });

  it("uses nonconsecutive snapshots while preserving exact threshold boundaries", () => {
    const result = evaluateDatabaseEvidence({
      connections: { total: 80, maximum: 100 },
      activeQueries: [{ queryId: "boundary", durationSeconds: 60 }],
      deadTupleSnapshots: [
        {
          snapshotDate: "2026-07-22",
          tables: [
            {
              tableName: "brands",
              deadTuplePercent: 99,
              deadTuples: 500,
              autovacuumThreshold: 100,
            },
            { tableName: "profiles", deadTuplePercent: 99 },
          ],
        },
        {
          snapshotDate: "2026-07-20",
          tables: [
            {
              tableName: "brands",
              deadTuplePercent: 99,
              deadTuples: 500,
              autovacuumThreshold: 100,
            },
            { tableName: "profiles", deadTuplePercent: 20 },
          ],
        },
      ],
      indexConcerns: [],
    });

    expect(result.findings.map((finding) => finding.fingerprint)).toEqual([
      "directory:dead-tuples:brands",
    ]);
  });

  it("does not flag high dead-tuple ratios below the effective autovacuum threshold", () => {
    const result = evaluateDatabaseEvidence({
      connections: { total: 1, maximum: 100 },
      activeQueries: [],
      deadTupleSnapshots: ["2026-07-20", "2026-07-22"].map((snapshotDate) => ({
        snapshotDate,
        tables: [
          {
            autovacuumThreshold: 50.4,
            deadTuplePercent: 40,
            deadTuples: 2,
            liveTuples: 2,
            tableName: "small_lookup",
          },
        ],
      })),
      indexConcerns: [],
    });

    expect(result.findings).toEqual([]);
  });

  it("routes only high/critical Dependabot alerts by known version impact", () => {
    const result = evaluateDependabotAlerts([
      {
        alertId: "major",
        packageName: "framework",
        severity: "critical",
        state: "open",
        versionImpact: "major",
      },
      {
        alertId: "patch",
        packageName: "parser",
        severity: "high",
        state: "open",
        versionImpact: "patch",
      },
      {
        alertId: "medium",
        packageName: "logger",
        severity: "medium",
        state: "open",
        versionImpact: "minor",
      },
      {
        alertId: "closed",
        packageName: "client",
        severity: "critical",
        state: "dismissed",
        versionImpact: "minor",
      },
    ]);

    expect(result.findings.map((finding) => finding.mergePolicy)).toEqual([
      "human",
      "automatic",
    ]);
    expect(result.findings.map((finding) => finding.fingerprint)).toEqual([
      "directory:dependabot:major",
      "directory:dependabot:patch",
    ]);
  });
});
