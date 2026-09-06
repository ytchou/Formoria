import { describe, expect, it } from "vitest";
import { ENRICH_LLM_PHASES, phasesForTask } from "@/lib/constants/enrich-phases";
import type { Json } from "@/lib/supabase/database.types";
import {
  planCurationResume,
  type CurationJobTarget,
  type CurationTargetStatus,
} from "./curation-jobs";

function target(
  overrides: {
    targetId?: string;
    status?: CurationTargetStatus;
    phaseResults?: Json;
  } = {},
): CurationJobTarget {
  return {
    id: `row-${overrides.targetId ?? "a"}`,
    job_id: "job-1",
    target_id: overrides.targetId ?? "sub-a",
    target_type: "submission",
    status: overrides.status ?? "failed",
    brand_name: "Test Brand",
    brand_slug: null,
    changed_fields: [],
    phase_results: overrides.phaseResults ?? [],
    current_phase: null,
    error: null,
    duration_ms: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-08-02T12:00:00.000Z",
  };
}

function phase(name: string, status: "succeeded" | "skipped" | "failed") {
  return { phase: name, status, changedFields: [], durationMs: 1 };
}

describe("planCurationResume", () => {
  it("unions explicitly failed phases with phases that were never recorded", () => {
    const plans = planCurationResume(null, [
      target({
        targetId: "sub-a",
        phaseResults: [
          phase("clean", "succeeded"),
          phase("detect", "succeeded"),
          phase("slugs", "succeeded"),
          phase("discover", "succeeded"),
          phase("links", "succeeded"),
          phase("images", "succeeded"),
          phase("classify_images", "failed"),
        ],
      }),
    ]);

    // `classify_images` failed outright, but it is DEFERRED and therefore not
    // in the default scope any more, so it drops out of the union rather than
    // being re-queued as a phase with no runner. Everything after it was never
    // reached, has no record at all, and is owed.
    expect(plans.at(0)?.params.phases).toEqual([
      "tags",
      "acquire",
      "names",
      "descriptions",
      "stockists",
      "faq",
      "products",
    ]);
  });

  it("expands an image-only source job into the visual closure, not the text phases", () => {
    const plans = planCurationResume({ steps: ["image"] } as Json, [
      target({ phaseResults: [phase("images", "failed")] }),
    ]);

    // The legacy `image` step used to resolve to the deferred image phases,
    // which have no runner. It now resolves to the visual task's closure
    // (`LEGACY_STEP_PHASES.image = phasesForTask("visual")`), because
    // `products` on its own is the self-insufficient scope of the DEV-1469
    // bug — it needs detect/acquire/names ahead of it. The closure stops
    // there: no descriptions, stockists, faq, or tags are dragged in.
    expect(plans.at(0)?.params.phases).toEqual([
      "detect",
      "acquire",
      "names",
      "products",
    ]);
  });

  it("falls back to the in-scope LLM phases when nothing looks unfinished", () => {
    // The 2026-08-02 records: every LLM phase wrote `succeeded` while OpenAI was
    // returning insufficient_quota, so the union is empty.
    const allGreen = [
      "clean",
      "detect",
      "slugs",
      "tags",
      "discover",
      "links",
      "acquire",
      "names",
      "site_identity",
      "images",
      "classify_images",
      "descriptions",
      "stockists",
      "faq",
      "products",
    ].map((name) => phase(name, "succeeded"));

    const plans = planCurationResume(null, [
      target({ phaseResults: allGreen }),
    ]);

    expect(plans.at(0)?.params.phases).toEqual([...ENRICH_LLM_PHASES]);
    expect(plans.at(0)?.params.phases).not.toContain("discover");
  });

  it("splits failed and cancelled targets into two jobs with different phases", () => {
    const plans = planCurationResume(
      { phases: ["discover", "descriptions"] } as Json,
      [
        target({
          targetId: "sub-failed",
          status: "failed",
          phaseResults: [
            phase("discover", "succeeded"),
            phase("descriptions", "failed"),
          ],
        }),
        target({ targetId: "sub-cancelled", status: "cancelled" }),
      ],
    );

    expect(plans.map((plan) => plan.group)).toEqual(["failed", "cancelled"]);
    expect(plans.at(0)?.params.phases).toEqual(["descriptions"]);
    expect(plans.at(0)?.params.submissionIds).toEqual(["sub-failed"]);
    // Cancelled targets never ran, so they get the source's full scope back —
    // minus `discover`, which is deferred and has no runner to resume into.
    expect(plans.at(1)?.params.phases).toEqual(["descriptions"]);
    expect(plans.at(1)?.params.submissionIds).toEqual(["sub-cancelled"]);
  });

  it("drops `steps` and `task` from every enqueued job because they beat phases at run time", () => {
    const plans = planCurationResume(
      { steps: ["context", "detail"], task: "full", stopAfter: 5 } as Json,
      [
        target({ targetId: "sub-failed", status: "failed" }),
        target({ targetId: "sub-cancelled", status: "cancelled" }),
      ],
    );

    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      expect(plan.params.steps).toBeUndefined();
      expect(plan.params.task).toBeUndefined();
      expect(plan.params.stopAfter).toBeUndefined();
      expect(plan.params.target).toBe("submissions");
    }
  });

  it("normalizes the legacy `expansion` phase name (now removed) into the full-scope fallback", () => {
    const plans = planCurationResume({ phases: ["expansion"] } as Json, [
      target({ phaseResults: [phase("expansion", "succeeded")] }),
    ]);

    // `expansion` normalizes to `reputation`, but `reputation` is no longer in
    // ENRICH_PHASES, so effectiveRequestedPhases falls through to the default
    // scope — the `full` task closure, which excludes the deferred phases.
    expect(plans.at(0)?.params.phases).toEqual(phasesForTask("full"));
  });

  it("preserves the source job's overwrite flag", () => {
    const plans = planCurationResume({ overwrite: true } as Json, [target()]);
    expect(plans.at(0)?.params.overwrite).toBe(true);
  });

  it("throws when no target is eligible", () => {
    expect(() => planCurationResume(null, [])).toThrow(
      /no failed or cancelled targets/i,
    );
  });
});
