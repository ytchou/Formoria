import { describe, expect, it } from "vitest";
import {
  ENRICH_PHASES,
  ENRICH_LLM_PHASES,
  phasesForTask,
} from "@/lib/constants/enrich-phases";
import { buildRecoveryPlan } from "./enrich-blocks/plan";
import { recoveryJobParams } from "./curation-jobs";

const target = {
  id: "ceramic-studio-submission",
  status: "failed",
  results: [],
  reusablePhases: [],
};

describe("historical recovery compatibility", () => {
  it("keeps an image-step recovery within the visual task scope", () => {
    const plan = buildRecoveryPlan({ steps: ["image"] }, { kind: "resume" }, [
      target,
    ]);
    expect(plan.targets[target.id]?.selected).toEqual(phasesForTask("visual"));
  });

  it("repeats in-scope LLM phases when old records report every phase succeeded", () => {
    const plan = buildRecoveryPlan(null, { kind: "resume" }, [
      {
        ...target,
        results: ENRICH_PHASES.map((phase) => ({ phase, status: "succeeded" })),
      },
    ]);
    expect(plan.targets[target.id]?.selected).toEqual(
      ENRICH_PHASES.filter((phase) =>
        (ENRICH_LLM_PHASES as readonly string[]).includes(phase),
      ),
    );
  });

  it("refuses to expand a retired-only job into full enrichment", () => {
    expect(() =>
      buildRecoveryPlan({ phases: ["expansion"] }, { kind: "resume" }, [
        target,
      ]),
    ).toThrow();
  });
});

describe("stored recovery parameters", () => {
  it("stores one mixed-target plan without inherited selectors truncating its targets", () => {
    const source = {
      task: "full",
      steps: ["context"],
      phases: ["faq"],
      stopAfter: 1,
      slugs: ["ceramic-studio"],
      overwrite: true,
      budgetScale: 1.5,
    };
    const plan = buildRecoveryPlan(source, { kind: "resume" }, [
      target,
      { ...target, id: "tea-studio-submission", status: "cancelled" },
    ]);
    const params = recoveryJobParams(source, plan);
    expect(params).toEqual({
      target: "submissions",
      submissionIds: [target.id, "tea-studio-submission"],
      overwrite: true,
      retry: plan,
    });
    expect(source.stopAfter).toBe(1);
  });

  it("does not turn a forced FAQ retry into blanket overwrite", () => {
    const plan = buildRecoveryPlan(
      {},
      { kind: "phase", block: "editorial", mode: "only", subPhase: "faq" },
      [target],
    );
    const params = recoveryJobParams({}, plan);
    expect(params.overwrite).toBe(false);
    expect(params.retry).toEqual({
      version: 1,
      action: {
        kind: "phase",
        block: "editorial",
        mode: "only",
        subPhase: "faq",
      },
      targets: {
        [target.id]: { selected: ["faq"], forced: ["faq"], explicit: ["faq"] },
      },
    });
  });
});
