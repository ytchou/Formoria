import { describe, expect, it } from "vitest";

import {
  DIRECTORY_QUERY_SPECS,
  evaluateApprovedBrandInvariants,
  evaluateDatabaseEvidence,
  evaluateDependabotAlerts,
  evaluateLinkTelemetry,
  evaluateStaleBranches,
} from "./directory";

describe("Directory Health policies", () => {
  it("publishes direct, approved-only brand queries", () => {
    const brandQueries = Object.values(DIRECTORY_QUERY_SPECS).filter(
      (query) => query.scope === "approved_brands",
    );

    expect(brandQueries).toHaveLength(2);
    for (const query of brandQueries) {
      expect(query.sql).toMatch(/from\s+brands/i);
      expect(query.sql).toMatch(/status\s*=\s*'approved'/i);
      expect(query.sql).not.toContain("get_brand_quality_metrics");
      expect(query.readOnly).toBe(true);
    }

    expect(DIRECTORY_QUERY_SPECS.deadTuples.sql).toMatch(
      /n_dead_tup\s*\/\s*\(n_live_tup\s*\+\s*n_dead_tup\)/i,
    );
    expect(DIRECTORY_QUERY_SPECS.deadTuples.sql).toMatch(
      /n_live_tup\s*\+\s*n_dead_tup\s*>\s*0/i,
    );
  });

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

  it("uses distinct failure dates, ignores 403/429, and escalates internal 404 immediately", () => {
    const result = evaluateLinkTelemetry([
      {
        recordId: "link-three-days",
        brandId: "brand-2",
        field: "purchase_website",
        target: "link",
        statusCode: 500,
        internalStorage: false,
        failureDates: ["2026-07-21", "2026-07-20", "2026-07-20", "2026-07-19"],
      },
      {
        recordId: "blocked",
        brandId: "brand-3",
        field: "purchase_website",
        target: "link",
        statusCode: 429,
        internalStorage: false,
        failureDates: ["2026-07-19", "2026-07-20", "2026-07-21"],
      },
      {
        recordId: "internal-missing",
        brandId: "brand-1",
        field: "hero_image_url",
        target: "image",
        statusCode: 404,
        internalStorage: true,
        failureDates: ["2026-07-21"],
      },
    ]);

    expect(result.findings.map((finding) => finding.fingerprint)).toEqual([
      "directory:link-cleanup:internal-missing",
      "directory:link-cleanup:link-three-days",
    ]);
    expect(result.findings[0]?.evidence).toEqual({
      brandId: "brand-1",
      cleanupRequired: true,
      distinctFailureDays: 1,
      failureDates: ["2026-07-21"],
      field: "hero_image_url",
      immediateInternalFailure: true,
      recordId: "internal-missing",
      statusCode: 404,
      target: "image",
    });
    expect(result.snapshot.blockedRecordIds).toEqual(["blocked"]);
    expect(result.snapshot.cleanupRequiredRecordIds).toEqual([
      "internal-missing",
      "link-three-days",
    ]);
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
            { tableName: "brands", deadTuplePercent: 21 },
            { tableName: "profiles", deadTuplePercent: 20 },
          ],
        },
        {
          snapshotDate: "2026-07-21",
          tables: [
            { tableName: "brands", deadTuplePercent: 20.01 },
            { tableName: "profiles", deadTuplePercent: 25 },
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
            { tableName: "brands", deadTuplePercent: 99 },
            { tableName: "profiles", deadTuplePercent: 99 },
          ],
        },
        {
          snapshotDate: "2026-07-20",
          tables: [
            { tableName: "brands", deadTuplePercent: 99 },
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

  it("marks a stale branch eligible only when every current-tip safety proof passes", () => {
    const common = {
      lastCommitAt: "2026-07-01T00:00:00.000Z",
      merged: true,
      openPullRequest: false,
      defaultBranch: false,
      protectedBranch: false,
      tipIsAncestorOfMain: true,
      currentMainSha: "main-sha",
    };
    const result = evaluateStaleBranches(
      [
        {
          ...common,
          branchRef: "refs/remotes/origin/safe",
          observedTipSha: "tip-safe",
          currentRemoteTipSha: "tip-safe",
        },
        {
          ...common,
          branchRef: "refs/remotes/origin/moved",
          observedTipSha: "tip-old",
          currentRemoteTipSha: "tip-new",
        },
        {
          ...common,
          branchRef: "refs/remotes/origin/open-pr",
          observedTipSha: "tip-open",
          currentRemoteTipSha: "tip-open",
          openPullRequest: true,
        },
      ],
      "2026-07-22T00:00:00.000Z",
    );

    expect(result.decisions.map((decision) => decision.branchRef)).toEqual([
      "refs/remotes/origin/moved",
      "refs/remotes/origin/open-pr",
      "refs/remotes/origin/safe",
    ]);
    expect(
      result.decisions.find((decision) => decision.branchRef.endsWith("/safe")),
    ).toMatchObject({
      eligible: true,
      reasons: [],
      evidence: { currentRemoteTipSha: "tip-safe", currentMainSha: "main-sha" },
    });
    expect(
      result.decisions.find((decision) => decision.branchRef.endsWith("/moved"))
        ?.reasons,
    ).toContain("remote_tip_changed");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.fingerprint).toBe(
      "directory:stale-branch:tip-safe",
    );
  });

  it("excludes branches at exactly fourteen days and is independent of input order", () => {
    const branch = {
      branchRef: "refs/remotes/origin/boundary",
      observedTipSha: "tip",
      currentRemoteTipSha: "tip",
      currentMainSha: "main",
      lastCommitAt: "2026-07-08T00:00:00.000Z",
      merged: true,
      openPullRequest: false,
      defaultBranch: false,
      protectedBranch: false,
      tipIsAncestorOfMain: true,
    };

    expect(
      evaluateStaleBranches([branch], "2026-07-22T00:00:00.000Z").decisions,
    ).toEqual([]);

    const forward = evaluateLinkTelemetry([
      {
        recordId: "z",
        brandId: "b",
        field: "hero_image_url",
        target: "image",
        statusCode: 500,
        internalStorage: false,
        failureDates: ["2026-07-20", "2026-07-21", "2026-07-22"],
      },
      {
        recordId: "a",
        brandId: "a",
        field: "purchase_website",
        target: "link",
        statusCode: 500,
        internalStorage: false,
        failureDates: ["2026-07-20", "2026-07-21", "2026-07-22"],
      },
    ]);
    const reverse = evaluateLinkTelemetry(
      [...forward.snapshot.records].reverse().map((record) => ({
        recordId: record.recordId,
        brandId: record.brandId,
        field: record.field,
        target: record.target,
        statusCode: record.statusCode,
        internalStorage: record.internalStorage,
        failureDates: record.failureDates,
      })),
    );

    expect(reverse).toEqual(forward);
  });
});
