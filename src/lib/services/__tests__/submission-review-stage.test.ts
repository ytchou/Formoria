import { describe, expect, it } from "vitest";

import {
  deriveSubmissionReviewStage,
  isSubmissionEnrichmentFailure,
} from "../submission-review-stage";

describe("deriveSubmissionReviewStage", () => {
  it("keeps a newly submitted brand in needs data", () => {
    expect(
      deriveSubmissionReviewStage({
        submissionStatus: "pending",
        targetStatus: null,
        jobStatus: null,
        dispatchStatus: null,
      }),
    ).toBe("needs_data");
  });

  it.each(["pending", "running"] as const)(
    "shows %s targets on active jobs as enriching",
    (targetStatus) => {
      expect(
        deriveSubmissionReviewStage({
          submissionStatus: "pending",
          targetStatus,
          jobStatus: "running",
          dispatchStatus: "dispatched",
        }),
      ).toBe("enriching");
    },
  );

  it("shows a successful target as ready", () => {
    expect(
      deriveSubmissionReviewStage({
        submissionStatus: "pending",
        targetStatus: "succeeded",
        jobStatus: "completed",
        dispatchStatus: "dispatched",
      }),
    ).toBe("ready");
  });

  it("moves a completed skipped target out of needs data", () => {
    expect(
      deriveSubmissionReviewStage({
        submissionStatus: "pending",
        targetStatus: "skipped",
        jobStatus: "completed",
        dispatchStatus: "dispatched",
      }),
    ).toBe("skipped");
  });

  it.each([
    {
      targetStatus: "failed",
      jobStatus: "failed",
      dispatchStatus: "dispatched",
    },
    { targetStatus: "pending", jobStatus: "pending", dispatchStatus: "failed" },
    {
      targetStatus: "running",
      jobStatus: "failed",
      dispatchStatus: "dispatched",
    },
  ] as const)(
    "returns terminal and dispatch failures to needs data",
    (state) => {
      expect(
        deriveSubmissionReviewStage({
          submissionStatus: "pending",
          ...state,
        }),
      ).toBe("needs_data");
    },
  );

  it("uses the persisted submission status after review", () => {
    expect(
      deriveSubmissionReviewStage({
        submissionStatus: "approved",
        targetStatus: "succeeded",
        jobStatus: "completed",
        dispatchStatus: "dispatched",
      }),
    ).toBe("approved");
  });
});

describe("isSubmissionEnrichmentFailure", () => {
  it("does not inherit a failed batch status after this target succeeds", () => {
    expect(
      isSubmissionEnrichmentFailure({
        targetStatus: "succeeded",
        jobStatus: "failed",
        dispatchStatus: "dispatched",
      }),
    ).toBe(false);
  });

  it.each([
    {
      targetStatus: "failed",
      jobStatus: "completed",
      dispatchStatus: "dispatched",
    },
    {
      targetStatus: null,
      jobStatus: "failed",
      dispatchStatus: "dispatched",
    },
  ] as const)("still reports genuine target and batch failures", (state) => {
    expect(isSubmissionEnrichmentFailure(state)).toBe(true);
  });
});
