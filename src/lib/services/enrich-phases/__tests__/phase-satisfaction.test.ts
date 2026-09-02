import { describe, it, expect } from "vitest";
import {
  checkPhaseSatisfaction,
  filterSatisfiedPhases,
  type PhaseHistory,
} from "../phase-satisfaction";
import { DEFERRED_PHASES, ENRICH_PHASES, PHASE_DEPENDENCIES, type EnrichPhaseName } from "@/lib/constants/enrich-phases";

describe("history-based phase satisfaction", () => {
  it("phase_with_no_history_is_unsatisfied", () => {
    expect(checkPhaseSatisfaction("links", new Map())).toBe("unsatisfied");
  });

  it("phase_succeeded_no_deps_is_satisfied", () => {
    // `clean` has no dependencies
    const history: PhaseHistory = new Map([
      ["clean", new Date("2026-08-01T00:00:00Z")],
    ]);
    expect(checkPhaseSatisfaction("clean", history)).toBe("satisfied");
  });

  it("phase_succeeded_deps_older_is_satisfied", () => {
    // `descriptions` depends on `links`; links older → satisfied
    const history: PhaseHistory = new Map([
      ["links", new Date("2026-08-01T00:00:00Z")],       // T=50
      ["descriptions", new Date("2026-08-02T00:00:00Z")], // T=100
    ]);
    expect(checkPhaseSatisfaction("descriptions", history)).toBe("satisfied");
  });

  it("phase_succeeded_dep_newer_is_unsatisfied", () => {
    // `descriptions` depends on `links`; links newer → stale
    const history: PhaseHistory = new Map([
      ["links", new Date("2026-08-02T00:00:00Z")],       // T=100
      ["descriptions", new Date("2026-08-01T00:00:00Z")], // T=50
    ]);
    expect(checkPhaseSatisfaction("descriptions", history)).toBe("unsatisfied");
  });

  it("force_overrides_to_unsatisfied", () => {
    const history: PhaseHistory = new Map([
      ["clean", new Date("2026-08-01T00:00:00Z")],
    ]);
    // Without force: satisfied (no deps, has history)
    expect(checkPhaseSatisfaction("clean", history)).toBe("satisfied");
    // With force: always unsatisfied
    expect(checkPhaseSatisfaction("clean", history, true)).toBe("unsatisfied");
  });

  it("all_phases_with_full_history_are_satisfied", () => {
    // Build a history where each phase is newer than all its deps.
    // Topological walk: a phase's timestamp = max(dep timestamps) + 1 day.
    const history: PhaseHistory = new Map<EnrichPhaseName, Date>();
    const BASE = Date.UTC(2026, 7, 1);
    function resolveTime(phase: EnrichPhaseName): number {
      const existing = history.get(phase);
      if (existing) return existing.getTime();
      const deps = PHASE_DEPENDENCIES[phase];
      const depMax = deps.length > 0
        ? Math.max(...deps.map((d) => resolveTime(d)))
        : BASE - 86_400_000;
      const ts = depMax + 86_400_000;
      history.set(phase, new Date(ts));
      return ts;
    }
    for (const phase of ENRICH_PHASES) resolveTime(phase);

    for (const phase of ENRICH_PHASES) {
      expect(
        checkPhaseSatisfaction(phase, history),
        `${phase} should be satisfied`,
      ).toBe("satisfied");
    }
  });

  it("filter_returns_correct_execute_and_skipped", () => {
    // links satisfied, descriptions stale (dep links is newer)
    const history: PhaseHistory = new Map([
      ["links", new Date("2026-08-02T00:00:00Z")],
      ["descriptions", new Date("2026-08-01T00:00:00Z")],
    ]);

    const result = filterSatisfiedPhases(
      ["links", "descriptions", "clean"],
      history,
    );

    expect(result.execute).toEqual(["descriptions", "clean"]);
    expect(result.skipped).toEqual([
      { phase: "links", reason: "satisfied" },
    ]);
  });

  it("deferred_phases_are_excluded_by_caller_not_by_satisfaction", () => {
    // Deferred phases (discover, clean, links, etc.) still exist in
    // ENRICH_PHASES for historical data. Phase satisfaction does not special-case
    // them — they are excluded by the caller (phasesForTask / CURATION_TASKS).
    // Verify that deferred phases with no history report as unsatisfied (the
    // caller must exclude them, satisfaction never lies about them).
    for (const phase of DEFERRED_PHASES) {
      expect(
        checkPhaseSatisfaction(phase, new Map()),
        `deferred phase ${phase} with no history should be unsatisfied`,
      ).toBe("unsatisfied");
    }
  });

  it("deferred_phases_with_history_are_satisfied", () => {
    // A deferred phase that ran historically should still report as satisfied
    // when it has history (correct for historical queries).
    const history: PhaseHistory = new Map([
      ["clean", new Date("2026-08-01T00:00:00Z")],
      ["discover", new Date("2026-08-01T00:00:00Z")],
    ]);
    expect(checkPhaseSatisfaction("clean", history)).toBe("satisfied");
    expect(checkPhaseSatisfaction("discover", history)).toBe("satisfied");
  });

  it("filter_excludes_deferred_phases_when_not_in_input", () => {
    // When the caller (phasesForTask) excludes deferred phases from the input
    // list, filterSatisfiedPhases never returns them.
    const history: PhaseHistory = new Map();
    const activePhases = ENRICH_PHASES.filter(
      (phase) => !(DEFERRED_PHASES as readonly string[]).includes(phase),
    );
    const result = filterSatisfiedPhases(activePhases, history);
    for (const phase of DEFERRED_PHASES) {
      expect(result.execute).not.toContain(phase);
      expect(result.skipped.map((s) => s.phase)).not.toContain(phase);
    }
  });

  it("transitive_staleness_propagates", () => {
    // discover (dep of detect) ran most recently at T=100
    // detect (dep of slugs) ran at T=50 — stale because discover is newer
    // slugs ran at T=25 — stale because detect is newer
    const history: PhaseHistory = new Map([
      ["discover", new Date("2026-08-03T00:00:00Z")], // T=100
      ["detect", new Date("2026-08-02T00:00:00Z")],   // T=50
      ["slugs", new Date("2026-08-01T00:00:00Z")],    // T=25
    ]);

    expect(checkPhaseSatisfaction("detect", history)).toBe("unsatisfied");
    expect(checkPhaseSatisfaction("slugs", history)).toBe("unsatisfied");
  });
});
