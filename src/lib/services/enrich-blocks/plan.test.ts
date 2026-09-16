import { describe, expect, it } from "vitest";
import {
  buildRecoveryPlan,
  readTargetPlan,
  validateRecoveryPlan,
} from "./plan";

describe("stored recovery scope", () => {
  // Catches unrelated targets inheriting another target's selected phases.
  it("keeps each target's authorized scope independent", () => {
    const retry = {
      version: 1,
      action: { kind: "resume" },
      targets: {
        "submission-maria": {
          selected: ["faq"],
          forced: [],
          explicit: ["faq"],
        },
        "submission-lin": {
          selected: ["acquire", "names"],
          forced: ["acquire"],
          explicit: [],
        },
      },
    };
    expect(readTargetPlan({ retry }, "submission-maria")).toEqual({
      selected: ["faq"],
      forced: [],
      explicit: ["faq"],
    });
    expect(readTargetPlan({ retry }, "submission-lin").selected).toEqual([
      "acquire",
      "names",
    ]);
  });

  // Catches historical FAQ retries escalating to the source job's full task.
  it("retains a historical FAQ retry's immediate scope", () => {
    expect(
      readTargetPlan(
        {
          task: "full",
          retry: { block: "editorial", mode: "only", subPhase: "faq" },
        },
        "submission-maria",
      ),
    ).toEqual({ selected: ["faq"], forced: ["faq"], explicit: ["faq"] });
  });

  // Catches malformed persisted plans falling back to full provider execution.
  it.each([
    { retry: null },
    { retry: {} },
    { retry: { block: "missing", mode: "only" } },
    { retry: { block: "acquire", mode: "only", subPhase: "faq" } },
    { retry: { version: 2, action: { kind: "resume" }, targets: {} } },
    { retry: { version: 1, action: { kind: "resume" }, targets: {} } },
    { phases: [] },
    { phases: ["typo"] },
  ])("rejects invalid scope before execution: %j", (params) => {
    expect(() => readTargetPlan(params, "submission-maria")).toThrow(
      /recovery|phase/i,
    );
  });

  // Catches force or explicit regeneration granting execution outside authorization.
  it("rejects forced and explicit phases outside selected scope", () => {
    for (const field of ["forced", "explicit"]) {
      expect(() =>
        validateRecoveryPlan({
          version: 1,
          action: { kind: "rerun" },
          targets: {
            "submission-maria": {
              selected: ["faq"],
              forced: [],
              explicit: [],
              [field]: ["products"],
            },
          },
        }),
      ).toThrow(/selected/);
    }
  });

  // Catches a missing target being treated as an ordinary full-enrichment job.
  it("rejects a target absent from the stored recovery map", () => {
    expect(() =>
      readTargetPlan(
        {
          retry: {
            version: 1,
            action: { kind: "resume" },
            targets: {
              "submission-lin": { selected: ["faq"], forced: [], explicit: [] },
            },
          },
        },
        "submission-maria",
      ),
    ).toThrow(/target/);
  });
});

describe("operator recovery planning", () => {
  const targetId = "submission-maria";
  const sourceParams = {
    retry: {
      version: 1,
      action: {
        kind: "phase",
        block: "editorial",
        mode: "only",
        subPhase: "faq",
      },
      targets: {
        [targetId]: { selected: ["faq"], forced: ["faq"], explicit: ["faq"] },
      },
    },
  };

  // Catches a recovery chain expanding beyond the immediately preceding job.
  it.each(["rerun", "resume"] as const)(
    "keeps FAQ-only scope through %s",
    (kind) => {
      const plan = buildRecoveryPlan(sourceParams, { kind }, [
        {
          id: targetId,
          status: "failed",
          results: [],
          reusablePhases: [],
        },
      ]);
      expect(plan.targets[targetId]).toEqual({
        selected: ["faq"],
        forced: ["faq"],
        explicit: ["faq"],
      });
    },
  );

  // Catches completed checkpoints being unnecessarily regenerated on Resume.
  it("permits merge-only recovery when all selected outputs are reusable", () => {
    const plan = buildRecoveryPlan(sourceParams, { kind: "resume" }, [
      {
        id: targetId,
        status: "failed",
        results: [],
        reusablePhases: ["faq"],
      },
    ]);
    expect(plan.targets[targetId]).toEqual({
      selected: ["faq"],
      forced: [],
      explicit: ["faq"],
    });
  });

  // Catches failed/cancelled targets inheriting each other's force policy.
  it("plans failed and cancelled targets independently in one recovery", () => {
    const plan = buildRecoveryPlan(
      { phases: ["acquire", "names"] },
      { kind: "resume" },
      [
        {
          id: "submission-maria",
          status: "failed",
          results: [],
          reusablePhases: ["acquire"],
        },
        {
          id: "submission-lin",
          status: "cancelled",
          results: [],
          reusablePhases: ["acquire", "names"],
        },
      ],
    );
    expect(plan.targets["submission-maria"]).toEqual({
      selected: ["acquire", "names"],
      forced: ["names"],
      explicit: ["acquire", "names"],
    });
    expect(plan.targets["submission-lin"]).toEqual({
      selected: ["acquire", "names"],
      forced: ["acquire", "names"],
      explicit: ["acquire", "names"],
    });
  });

  // Catches historical Resume repaying completed phases when no checkpoints exist.
  it("retains historical unfinished-phase recovery within the source scope", () => {
    const plan = buildRecoveryPlan(
      { phases: ["acquire", "names", "faq"] },
      { kind: "resume" },
      [
        {
          id: targetId,
          status: "failed",
          reusablePhases: [],
          results: [
            { phase: "acquire", status: "succeeded" },
            { phase: "names", status: "failed" },
          ],
        },
      ],
    );
    expect(plan.targets[targetId]).toEqual({
      selected: ["names", "faq"],
      forced: ["names", "faq"],
      explicit: ["names", "faq"],
    });
  });

  // Catches arbitrary statuses getting silently converted into a Resume job.
  it("rejects a succeeded target from Resume", () => {
    expect(() =>
      buildRecoveryPlan(sourceParams, { kind: "resume" }, [
        {
          id: targetId,
          status: "succeeded",
          results: [],
          reusablePhases: [],
        },
      ]),
    ).toThrow(/failed or cancelled/);
  });
});
