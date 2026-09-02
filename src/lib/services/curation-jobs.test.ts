import { describe, expect, it } from "vitest";
import {
  effectiveRequestedPhases,
  isExplicitSubmissionEligible,
  isManualRerunTargetEligible,
  type CurationJobParams,
} from "./curation-jobs";
import {
  CURATION_TASK_ORDER,
  CURATION_TASKS,
  ENRICH_PHASES,
  phasesForTask,
} from "@/lib/constants/enrich-phases";
import {
  filterSatisfiedPhases,
  type PhaseHistory,
} from "./enrich-phases/phase-satisfaction";
import type { EnrichPhaseName } from "@/lib/constants/enrich-phases";

describe("explicit submission enrichment eligibility", () => {
  it("allows an admin to queue a selected pending refresh submission", () => {
    expect(
      isExplicitSubmissionEligible({ status: "pending", intent: "refresh" }),
    ).toBe(true);
  });
});

describe("manual rerun target eligibility", () => {
  it("allows a completed job's skipped submission to be rerun", () => {
    expect(
      isManualRerunTargetEligible({
        sourceStatus: "completed",
        targetStatus: "skipped",
        isIncompleteSubmission: false,
      }),
    ).toBe(true);
  });
});

describe("task-based phase resolution", () => {
  it("task_param_resolves_to_phase_closure", () => {
    const params: CurationJobParams = { task: "visual" };
    const phases = effectiveRequestedPhases(params);
    // visual's closure: products and its transitive deps (acquire, names, detect)
    expect(phases).toContain("detect");
    expect(phases).toContain("acquire");
    expect(phases).toContain("names");
    expect(phases).toContain("products");
    // Deferred phases must not appear in the closure
    expect(phases).not.toContain("links");
    expect(phases).not.toContain("site_identity");
    expect(phases).not.toContain("images");
    expect(phases).not.toContain("classify_images");
    // Must exclude unrelated phases
    expect(phases).not.toContain("descriptions");
    expect(phases).not.toContain("reputation");
    expect(phases).not.toContain("faq");
  });

  it("legacy_steps_param_still_parses", () => {
    // A stored row carrying params.steps from before the task vocabulary
    // must still resolve to phases without throwing.
    const params: CurationJobParams = { steps: ["context", "image"] };
    const phases = effectiveRequestedPhases(params);
    expect(phases).toContain("detect");
    expect(phases).toContain("acquire");
    expect(phases).toContain("names");
    // Legacy image step still maps to deferred phases (they exist in ENRICH_PHASES)
    expect(phases).toContain("images");
    expect(phases).toContain("classify_images");
    expect(phases).not.toContain("descriptions");
  });

  it("phases_param_remains_an_escape_hatch", () => {
    // Explicit phases win over everything else.
    const params: CurationJobParams = {
      phases: ["links", "products"],
      task: "full",
    };
    const phases = effectiveRequestedPhases(params);
    expect(phases).toEqual(["links", "products"]);
  });

  it("falls back to all phases when nothing is specified", () => {
    const params: CurationJobParams = {};
    const phases = effectiveRequestedPhases(params);
    expect(phases).toEqual([...ENRICH_PHASES]);
  });

  it("ignores unknown legacy step names and keeps deferred phases from mapping", () => {
    const params: CurationJobParams = { steps: ["unknown_step", "image"] };
    const phases = effectiveRequestedPhases(params);
    // Legacy image step maps to deferred phases that still exist in ENRICH_PHASES
    expect(phases).toEqual(["images", "classify_images"]);
  });
});

describe("admin bulk actions", () => {
  it("admin_bulk_actions_offer_tasks", () => {
    // The admin UI iterates CURATION_TASK_ORDER to build its bulk action
    // entries. This test asserts the vocabulary is task-based, not step-based.
    expect(CURATION_TASK_ORDER).toContain("identity");
    expect(CURATION_TASK_ORDER).toContain("visual");
    expect(CURATION_TASK_ORDER).toContain("editorial");
    expect(CURATION_TASK_ORDER).toContain("full");
    // Hidden aliases are valid task keys but excluded from the order
    expect(CURATION_TASK_ORDER).not.toContain("image");
    expect(CURATION_TASK_ORDER).not.toContain("product");
    // Old step names must not appear
    for (const task of CURATION_TASK_ORDER) {
      expect(task).not.toBe("context");
      expect(task).not.toBe("detail");
    }
    // Every task key has a corresponding entry in CURATION_TASKS
    for (const task of CURATION_TASK_ORDER) {
      expect(CURATION_TASKS).toHaveProperty(task);
    }
  });
});

describe("satisfaction-based phase skipping", () => {
  function makeHistory(
    entries: Array<[EnrichPhaseName, Date]> = [],
  ): PhaseHistory {
    return new Map(entries);
  }

  it("satisfied_prerequisites_are_skipped", () => {
    const resolved = phasesForTask("visual");
    // detect and acquire have history entries (both satisfied), other deps do not
    const history = makeHistory([
      ["detect", new Date("2026-07-31T00:00:00Z")],
      ["acquire", new Date("2026-08-01T00:00:00Z")],
    ]);

    const { execute, skipped } = filterSatisfiedPhases(resolved, history);

    expect(skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "detect", reason: "satisfied" }),
        expect.objectContaining({ phase: "acquire", reason: "satisfied" }),
      ]),
    );
    expect(execute).not.toContain("detect");
    expect(execute).not.toContain("acquire");
    expect(execute).toContain("products");
    expect(execute).toContain("names");
  });
});

describe("explicitPhases provenance", () => {
  it("task_derived_faq_is_not_explicit", () => {
    // A task=editorial closure contains faq, but it was derived, not named
    // literally by the operator. The explicitPhases for a task-derived run
    // is [] — the non-forcing default.
    const params: CurationJobParams = { task: "editorial" };
    const resolved = effectiveRequestedPhases(params);
    expect(resolved).toContain("faq");

    // explicitPhases is set by the caller based on whether params.phases
    // was present. For a task-derived run, params.phases is absent.
    const explicitPhases = params.phases ?? [];
    expect(explicitPhases).toEqual([]);
    expect(explicitPhases).not.toContain("faq");
  });

  it("literal_phases_faq_is_explicit", () => {
    // An operator naming faq in params.phases is explicit — it triggers
    // force-regeneration guards.
    const params: CurationJobParams = { phases: ["faq"] };
    const resolved = effectiveRequestedPhases(params);
    expect(resolved).toContain("faq");

    const explicitPhases = params.phases ?? [];
    expect(explicitPhases).toContain("faq");
  });
});
