import { describe, expect, it } from "vitest";

import type { TrailSupplyReport } from "@/lib/services/trail-supply-report";

import { evaluateTrailSupply, trailSupplyArtifact } from "./trail-supply";

const COLLECTED_AT = "2026-08-20T00:00:00.000Z";

function report(overrides: Partial<TrailSupplyReport> = {}): TrailSupplyReport {
  return {
    emptySections: [],
    orphanedSelections: [],
    readUnavailable: false,
    selectionsObserved: 0,
    trailsObserved: 0,
    ...overrides,
  };
}

const DECAYED = report({
  emptySections: [
    {
      sectionKey: "tableware",
      sectionTitle: "Everyday tableware",
      trailSlug: "autumn-kitchen",
    },
    {
      sectionKey: "glassware",
      sectionTitle: "Glassware",
      trailSlug: "autumn-kitchen",
    },
  ],
  orphanedSelections: [
    { reason: "unknown_trail", sectionKey: "mugs", trailSlug: "retired-trail" },
    {
      reason: "undeclared_section",
      sectionKey: "dropped",
      trailSlug: "autumn-kitchen",
    },
  ],
  selectionsObserved: 9,
  trailsObserved: 2,
});

describe("trail supply decay detector", () => {
  it("emits_one_finding_per_empty_section", () => {
    const findings = evaluateTrailSupply(
      report({
        emptySections: DECAYED.emptySections,
        trailsObserved: 1,
      }),
    );

    expect(findings).toHaveLength(2);
    expect(findings.map((entry) => entry.fingerprint)).toEqual([
      "directory:trail-empty-section:autumn-kitchen:glassware",
      "directory:trail-empty-section:autumn-kitchen:tableware",
    ]);
    expect(new Set(findings.map((entry) => entry.fingerprint)).size).toBe(2);
    expect(findings.map((entry) => entry.evidence)).toEqual([
      {
        sectionKey: "glassware",
        sectionTitle: "Glassware",
        trailSlug: "autumn-kitchen",
      },
      {
        sectionKey: "tableware",
        sectionTitle: "Everyday tableware",
        trailSlug: "autumn-kitchen",
      },
    ]);
  });

  it("emits_no_findings_when_read_unavailable", () => {
    // The arrays are deliberately non-empty: a dormant run must emit nothing
    // even if a malformed payload carries decay alongside the flag. The guard
    // runs before the mapping, so nothing here can be fabricated into a
    // finding.
    const dormant = report({
      emptySections: DECAYED.emptySections,
      orphanedSelections: DECAYED.orphanedSelections,
      readUnavailable: true,
    });

    expect(evaluateTrailSupply(dormant)).toEqual([]);

    const artifact = trailSupplyArtifact({
      collectedAt: COLLECTED_AT,
      report: dormant,
    });
    expect(artifact.findings).toEqual([]);
    expect(artifact.status).toBe("skipped");
    // Never "failed": dormancy is the expected production state, and a nightly
    // red would be alarm fatigue by construction.
    expect(artifact.status).not.toBe("failed");
  });

  it("fingerprints_are_stable_across_runs", () => {
    const first = evaluateTrailSupply(DECAYED).map(
      (entry) => entry.fingerprint,
    );
    const second = evaluateTrailSupply(DECAYED).map(
      (entry) => entry.fingerprint,
    );

    expect(second).toEqual(first);
    expect(first).toHaveLength(4);
    expect(first.every((fingerprint) => fingerprint.startsWith("directory:")))
      .toBe(true);
  });

  it("marks_every_finding_report_only_and_human_owned", () => {
    const findings = evaluateTrailSupply(DECAYED);

    expect(findings).not.toHaveLength(0);
    for (const entry of findings) {
      expect(entry.source).toBe("directory");
      expect(entry.severity).toBe("medium");
      expect(entry.disposition).toBe("report_only");
      expect(entry.mergePolicy).toBe("human");
      expect(entry.humanReason).toBeTruthy();
    }
  });

  it("emits_orphan_findings_carrying_their_reason", () => {
    const orphans = evaluateTrailSupply(DECAYED).filter((entry) =>
      entry.fingerprint.startsWith("directory:trail-orphaned-selection:"),
    );

    expect(orphans.map((entry) => entry.fingerprint)).toEqual([
      "directory:trail-orphaned-selection:autumn-kitchen:dropped",
      "directory:trail-orphaned-selection:retired-trail:mugs",
    ]);
    // Distinct from the empty-section kind, and distinct from each other.
    expect(new Set(orphans.map((entry) => entry.fingerprint)).size).toBe(2);
    expect(orphans.map((entry) => entry.evidence.reason)).toEqual([
      "undeclared_section",
      "unknown_trail",
    ]);
  });

  it("records_observation_counts_in_the_artifact", () => {
    const artifact = trailSupplyArtifact({
      collectedAt: COLLECTED_AT,
      report: report({ selectionsObserved: 9, trailsObserved: 3 }),
    });

    expect(artifact.findings).toEqual([]);
    expect(artifact.status).toBe("success");
    expect(artifact.evidence).toMatchObject({
      selectionsObserved: 9,
      trailsObserved: 3,
    });
    expect(artifact.snapshot).toMatchObject({
      selectionsObserved: 9,
      trailsObserved: 3,
    });
    expect(artifact.routine).toBe("trail-supply");
    expect(artifact.failures).toEqual([]);
    expect(artifact.collectedAt).toBe(COLLECTED_AT);
  });
});
