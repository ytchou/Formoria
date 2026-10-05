import type {
  CurationDispatchStatus,
  CurationTargetStatus,
} from "./curation-jobs";

export type SubmissionReviewStage =
  | "needs_data"
  | "enriching"
  | "skipped"
  | "ready"
  | "approved"
  | "rejected";

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

  if (targetStatus === "skipped") {
    return "skipped";
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

/**
 * Picks the curation target row a submission's review stage derives from,
 * given that submission's rows newest first (`created_at desc, id desc`).
 *
 * The true latest row wins, except when it is a no-op rerun (DEV-1929) and the
 * latest row that actually ran is `succeeded`: the apply/approve gates skip
 * no-op rows, so that submission is ready. In every other case the true latest
 * row is used, which keeps the stage equal to the one the
 * `drop_needs_data_submissions` RPC derives (it does not skip no-op rows), so
 * the UI never offers a Drop the RPC would refuse.
 */
export function selectStageTarget<
  T extends { status: string; no_op: boolean },
>(rowsNewestFirst: readonly T[]): T | undefined {
  const latest = rowsNewestFirst.at(0);
  if (!latest?.no_op) return latest;
  const latestThatRan = rowsNewestFirst.find((row) => !row.no_op);
  return latestThatRan?.status === "succeeded" ? latestThatRan : latest;
}
