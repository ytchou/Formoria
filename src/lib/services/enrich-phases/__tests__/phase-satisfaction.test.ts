import { describe, it, expect } from "vitest";
import {
  checkPhaseSatisfaction,
  fetchPhaseHistory,
  filterSatisfiedPhases,
  type PhaseHistory,
} from "../phase-satisfaction";
import { DEFERRED_PHASES, ENRICH_PHASES, PHASE_DEPENDENCIES, type EnrichPhaseName } from "@/lib/constants/enrich-phases";
import type { PhaseOutputStore, PhaseOutputRow } from "@/lib/services/enrich-blocks/phase-outputs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeRow(overrides: Partial<PhaseOutputRow> & Pick<PhaseOutputRow, "phase" | "created_at">): PhaseOutputRow {
  return {
    id: "row-1",
    job_id: "job-1",
    target_id: "brand-1",
    target_type: "brand",
    status: "succeeded",
    output: { patch: {} },
    persisted_at: null,
    ...overrides,
  };
}

function fakeStore(rows: PhaseOutputRow[]): PhaseOutputStore {
  return {
    reader: {
      forTargets: async () => rows,
      latestPerPhase: async () => rows,
      unpersisted: async () => [],
    },
    writer: {
      upsert: async () => [],
    },
  };
}

function failingStore(error: Error): PhaseOutputStore {
  return {
    reader: {
      forTargets: async () => { throw error; },
      latestPerPhase: async () => { throw error; },
      unpersisted: async () => [],
    },
    writer: {
      upsert: async () => [],
    },
  };
}

// ---------------------------------------------------------------------------
// fetchPhaseHistory (backed by phase-outputs store)
// ---------------------------------------------------------------------------

describe("fetchPhaseHistory (phase-outputs store)", () => {
  it("history_comes_from_phase_outputs_latest_succeeded", async () => {
    const store = fakeStore([
      // Two rows for detect — newest first; only the first should win
      fakeRow({ phase: "detect", created_at: "2026-09-02T00:00:00Z", id: "r1" }),
      fakeRow({ phase: "detect", created_at: "2026-09-01T00:00:00Z", id: "r2" }),
      // One succeeded acquire row
      fakeRow({ phase: "acquire", created_at: "2026-09-03T00:00:00Z", id: "r3" }),
      // A failed row should be excluded
      fakeRow({ phase: "descriptions", created_at: "2026-09-04T00:00:00Z", status: "failed", id: "r4" }),
      // An unknown phase should be excluded
      fakeRow({ phase: "nonexistent_phase", created_at: "2026-09-04T00:00:00Z", id: "r5" }),
    ]);

    const history = await fetchPhaseHistory("brand", "brand-1", store);

    expect(history.size).toBe(2);
    expect(history.get("detect")).toEqual(new Date("2026-09-02T00:00:00Z"));
    expect(history.get("acquire")).toEqual(new Date("2026-09-03T00:00:00Z"));
    expect(history.has("descriptions")).toBe(false);
    expect(history.has("nonexistent_phase" as EnrichPhaseName)).toBe(false);
  });

  it("query_error_throws", async () => {
    const store = failingStore(new Error("db connection failed"));

    await expect(
      fetchPhaseHistory("brand", "brand-1", store),
    ).rejects.toThrow("db connection failed");
  });
});

// ---------------------------------------------------------------------------
// history-based phase satisfaction (unchanged logic)
// ---------------------------------------------------------------------------

describe("history-based phase satisfaction", () => {
  it("dependency_recency_rule_unchanged", () => {
    // Satisfied: descriptions ran after acquire and detect
    const satisfiedHistory: PhaseHistory = new Map([
      ["detect", new Date("2026-07-31T00:00:00Z")],
      ["acquire", new Date("2026-08-01T00:00:00Z")],
      ["descriptions", new Date("2026-08-02T00:00:00Z")],
    ]);
    expect(checkPhaseSatisfaction("descriptions", satisfiedHistory)).toBe("satisfied");

    // Unsatisfied: acquire ran after descriptions (dep newer)
    const staleHistory: PhaseHistory = new Map([
      ["detect", new Date("2026-07-30T00:00:00Z")],
      ["acquire", new Date("2026-08-02T00:00:00Z")],
      ["descriptions", new Date("2026-08-01T00:00:00Z")],
    ]);
    expect(checkPhaseSatisfaction("descriptions", staleHistory)).toBe("unsatisfied");

    // Force overrides to unsatisfied
    expect(checkPhaseSatisfaction("descriptions", satisfiedHistory, true)).toBe("unsatisfied");
  });

  it("phase_with_no_history_is_unsatisfied", () => {
    expect(checkPhaseSatisfaction("acquire", new Map())).toBe("unsatisfied");
  });

  it("satisfaction_reads_acquire_history", () => {
    // The phase records itself as `acquire`, so an `acquire` row satisfies it.
    // `detect` is its only dependency and shares the row's timestamp, which is
    // not newer, so the acquisition is not stale.
    const acquireHistory: PhaseHistory = new Map([
      ["detect", new Date("2026-09-01T00:00:00Z")],
      ["acquire", new Date("2026-09-01T00:00:00Z")],
    ]);
    expect(checkPhaseSatisfaction("acquire", acquireHistory)).toBe("satisfied");

    // A PR-1-era row recorded the retired name `links`. It must NOT satisfy
    // `acquire`: the brand is re-acquired, which is the documented behaviour
    // (the two phases produced different evidence packs).
    const legacyHistory: PhaseHistory = new Map([
      ["detect", new Date("2026-09-01T00:00:00Z")],
      ["links", new Date("2026-09-01T00:00:00Z")],
    ]);
    expect(checkPhaseSatisfaction("acquire", legacyHistory)).toBe(
      "unsatisfied",
    );
  });

  it("phase_succeeded_no_deps_is_satisfied", () => {
    // `clean` has no dependencies
    const history: PhaseHistory = new Map([
      ["clean", new Date("2026-08-01T00:00:00Z")],
    ]);
    expect(checkPhaseSatisfaction("clean", history)).toBe("satisfied");
  });

  it("phase_succeeded_deps_older_is_satisfied", () => {
    // `descriptions` depends on `acquire` (which depends on `detect`);
    // all deps older → satisfied
    const history: PhaseHistory = new Map([
      ["detect", new Date("2026-07-31T00:00:00Z")],        // T=0
      ["acquire", new Date("2026-08-01T00:00:00Z")],       // T=50
      ["descriptions", new Date("2026-08-02T00:00:00Z")], // T=100
    ]);
    expect(checkPhaseSatisfaction("descriptions", history)).toBe("satisfied");
  });

  it("phase_succeeded_dep_newer_is_unsatisfied", () => {
    // `descriptions` depends on `acquire`; acquire newer → stale
    const history: PhaseHistory = new Map([
      ["detect", new Date("2026-07-30T00:00:00Z")],        // T=0
      ["acquire", new Date("2026-08-02T00:00:00Z")],       // T=100
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
    // acquire satisfied (detect dep is older), descriptions stale (dep acquire is newer)
    const history: PhaseHistory = new Map([
      ["detect", new Date("2026-07-31T00:00:00Z")],
      ["acquire", new Date("2026-08-02T00:00:00Z")],
      ["descriptions", new Date("2026-08-01T00:00:00Z")],
    ]);

    const result = filterSatisfiedPhases(
      ["acquire", "descriptions", "clean"],
      history,
    );

    expect(result.execute).toEqual(["descriptions", "clean"]);
    expect(result.skipped).toEqual([
      { phase: "acquire", reason: "satisfied" },
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
    // detect (dep of acquire) ran most recently at T=100
    // acquire (dep of descriptions) ran at T=50 — stale because detect is newer
    // descriptions ran at T=25 — stale because acquire is newer
    const history: PhaseHistory = new Map([
      ["detect", new Date("2026-08-03T00:00:00Z")],       // T=100
      ["acquire", new Date("2026-08-02T00:00:00Z")],      // T=50
      ["descriptions", new Date("2026-08-01T00:00:00Z")], // T=25
    ]);

    expect(checkPhaseSatisfaction("acquire", history)).toBe("unsatisfied");
    expect(checkPhaseSatisfaction("descriptions", history)).toBe("unsatisfied");
  });
});
