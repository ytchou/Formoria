import type {
  CurationDispatchStatus,
  CurationTargetStatus,
} from "./curation-jobs";

export type SubmissionReviewStage =
  "needs_data" | "enriching" | "ready" | "approved" | "rejected";

type SubmissionReviewStageInput = {
  submissionStatus: string;
  targetStatus: CurationTargetStatus | null;
  jobStatus: string | null;
  dispatchStatus: CurationDispatchStatus | null;
};

export function deriveSubmissionReviewStage({
  submissionStatus,
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

  if (targetStatus === "succeeded") {
    return "ready";
  }

  return "needs_data";
}

export function isSubmissionEnrichmentFailure({
  targetStatus,
  jobStatus,
  dispatchStatus,
}: Pick<
  SubmissionReviewStageInput,
  "targetStatus" | "jobStatus" | "dispatchStatus"
>): boolean {
  if (targetStatus === "succeeded" || targetStatus === "skipped") return false;

  return (
    targetStatus === "failed" ||
    dispatchStatus === "failed" ||
    jobStatus === "failed" ||
    jobStatus === "cancelled"
  );
}
