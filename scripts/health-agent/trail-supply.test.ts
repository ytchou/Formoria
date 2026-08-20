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

  it("gives_each_orphan_reason_its_own_rendered_title", () => {
    // `groupedLinearDescription` renders `<count> x <title> - <samples>` and no
    // adapter renders `finding.evidence`, so the title is the only text that
    // tells a human which repair to make: retarget the row, or re-declare or
    // retire the section.
    const orphans = evaluateTrailSupply(DECAYED).filter((entry) =>
      entry.fingerprint.startsWith("directory:trail-orphaned-selection:"),
    );
    const titlesByReason = new Map(
      orphans.map((entry) => [String(entry.evidence.reason), entry.title]),
    );

    expect(titlesByReason.size).toBe(2);
    expect(new Set(titlesByReason.values()).size).toBe(2);
    expect(titlesByReason.get("unknown_trail")).toContain("trail");
    expect(titlesByReason.get("undeclared_section")).toContain("section");
    // Distinct titles must not have bought a changed fingerprint: the
    // fingerprint is the ticket identity and stays one kind per orphan class.
    expect(orphans.map((entry) => entry.fingerprint)).toEqual([
      "directory:trail-orphaned-selection:autumn-kitchen:dropped",
      "directory:trail-orphaned-selection:retired-trail:mugs",
    ]);
  });

  it("caps_the_findings_and_says_so_when_it_truncates", () => {
    // MAX_ARTIFACT_BYTES and MAX_RESULT_BYTES are both 512KB, so findings that
    // just fit this artifact's own write check can still push the MERGED
    // directory-health.json past readBoundedJson — and Stage 3 then loses the
    // directory, brand AND trail findings behind one generic string.
    const storm = report({
      emptySections: Array.from({ length: 640 }, (_, index) => ({
        sectionKey: `section-${String(index).padStart(4, "0")}`,
        sectionTitle: `Section ${index}`,
        trailSlug: "autumn-kitchen",
      })),
      selectionsObserved: 640,
      trailsObserved: 1,
    });

    const artifact = trailSupplyArtifact({
      collectedAt: COLLECTED_AT,
      report: storm,
    });

    expect(evaluateTrailSupply(storm)).toHaveLength(640);
    expect(artifact.findings).toHaveLength(500);
    // A truncated run must never read as a complete one, on either surface.
    expect(artifact.evidence).toMatchObject({
      emptySectionCount: 640,
      findingCount: 500,
      findingsOmitted: 140,
    });
    expect(artifact.failures).toContain("trail_supply_findings_truncated");
    expect(artifact.failure).toBe("trail_supply_findings_truncated");
  });

  it("leaves_no_truncation_marker_on_a_complete_run", () => {
    const artifact = trailSupplyArtifact({
      collectedAt: COLLECTED_AT,
      report: DECAYED,
    });

    expect(artifact.findings).toHaveLength(4);
    expect(artifact.evidence).toMatchObject({ findingCount: 4 });
    expect(artifact.evidence).not.toHaveProperty("findingsOmitted");
    expect(artifact.failures).toEqual([]);
    expect(artifact.failure).toBeUndefined();
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
