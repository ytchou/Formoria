import type {
  CurationDispatchStatus,
  CurationTargetStatus,
} from "./curation-jobs";

export type SubmissionReviewStage =
  "needs_data" | "enriching" | "ready" | "approved" | "rejected";

type SubmissionReviewStageInput = {
  submissionStatus: string;
  enrichmentComplete: boolean;
  targetStatus: CurationTargetStatus | null;
  jobStatus: string | null;
  dispatchStatus: CurationDispatchStatus | null;
};

export function deriveSubmissionReviewStage({
  submissionStatus,
  enrichmentComplete,
  targetStatus,
  jobStatus,
  dispatchStatus,
}: SubmissionReviewStageInput): SubmissionReviewStage {
  if (submissionStatus === "approved" || submissionStatus === "rejected") {
    return submissionStatus;
  }

  const jobIsActive =
    (jobStatus === "pending" || jobStatus === "running") &&
    dispatchStatus !== "failed";
  if (
    jobIsActive &&
    (targetStatus === "pending" || targetStatus === "running")
  ) {
    return "enriching";
  }

  if (targetStatus === "succeeded" && enrichmentComplete) {
    return "ready";
  }

  return "needs_data";
}
