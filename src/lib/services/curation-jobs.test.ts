import { describe, expect, it } from "vitest";
import {
  isExplicitSubmissionEligible,
  isManualRerunTargetEligible,
} from "./curation-jobs";

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
