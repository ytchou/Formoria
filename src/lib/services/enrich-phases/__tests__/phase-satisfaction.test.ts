import { describe, it, expect } from "vitest";
import {
  checkPhaseSatisfaction,
  filterSatisfiedPhases,
  type PhaseHistory,
} from "../phase-satisfaction";
import { ENRICH_PHASES, type EnrichPhaseName } from "@/lib/constants/enrich-phases";

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
    // Use ENRICH_PHASES order — each subsequent phase gets a later timestamp.
    const history: PhaseHistory = new Map<EnrichPhaseName, Date>();
    for (let i = 0; i < ENRICH_PHASES.length; i++) {
      history.set(ENRICH_PHASES[i], new Date(Date.UTC(2026, 7, 1 + i)));
    }

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
