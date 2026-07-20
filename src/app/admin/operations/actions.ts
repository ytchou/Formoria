"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/require-admin";
import {
  cancelCurationJob,
  enqueueAdminCurationJob,
  enqueueManualRerun,
  getCurationJob,
  getCurationJobDetail,
  markCurationJobDispatched,
  recordCurationDispatchFailure,
  listCurationJobs,
  type CurationJob,
  type CurationDispatchStatus,
  type CurationJobDetail,
  type CurationJobParams,
} from "@/lib/services/curation-jobs";
import {
  dispatchCurationJob,
  sanitizeDispatchError,
} from "@/lib/services/curation-dispatch";
import { logAdminAction } from "@/lib/services/admin-audit";
import { getSubmissionsForReview } from "@/lib/services/submissions";

type StartCurationOperation = "enrich" | "clean-names";
export type QueuedJobResult = {
  jobId: string;
  detailPath: string;
  queued: true;
  dispatchStatus: CurationDispatchStatus;
  message: string;
};

export async function startCurationJobAction(
  operation: StartCurationOperation,
  params: CurationJobParams,
  dryRun: boolean,
): Promise<QueuedJobResult | { error: string }> {
  try {
    const auth = await requireAdminAction();
    if ("error" in auth) return auth;
    if (operation !== "enrich") {
      return { error: "Operation removed — use enrich instead" };
    }

    const job = await enqueueAdminCurationJob({
      params,
      dryRun,
      startedBy: auth.user.email ?? auth.user.id,
    });
    revalidatePath("/admin/jobs");
    revalidatePath("/admin/submissions");

    return dispatchQueuedJob(job.id, "Data job created and dispatching now.");
  } catch (error) {
    console.error("[admin:startCurationJobAction]", error);
    return {
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}

export async function startNeedsDataSubmissionEnrichmentAction(): Promise<
  QueuedJobResult | { error: string }
> {
  try {
    const auth = await requireAdminAction();
    if ("error" in auth) return auth;

    const submissionIds = (await getSubmissionsForReview({ status: "pending" }))
      .filter((submission) => submission.reviewStage === "needs_data")
      .map((submission) => submission.id);
    if (submissionIds.length === 0) {
      return { error: "No needs-data submissions are waiting for enrichment" };
    }

    const job = await enqueueAdminCurationJob({
      params: { submissionIds },
      dryRun: false,
      startedBy: auth.user.email ?? auth.user.id,
    });
    revalidatePath("/admin");
    revalidatePath("/admin/jobs");
    revalidatePath("/admin/submissions");
    return dispatchQueuedJob(
      job.id,
      `${submissionIds.length} submissions queued for enrichment.`,
    );
  } catch (error) {
    console.error("[admin:startNeedsDataSubmissionEnrichmentAction]", error);
    return {
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}

export async function rerunCurationJobAction(
  jobId: string,
): Promise<QueuedJobResult | { error: string }> {
  try {
    const auth = await requireAdminAction();
    if ("error" in auth) return auth;

    const job = await enqueueManualRerun(
      jobId,
      auth.user.email ?? auth.user.id,
    );
    revalidatePath("/admin/jobs");
    revalidatePath(`/admin/jobs/${jobId}`);

    return dispatchQueuedJob(
      job.id,
      "Rerun job created for failed or unfinished brands, dispatching now.",
    );
  } catch (error) {
    console.error("[admin:rerunCurationJobAction]", error);
    return {
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}

export async function listCurationJobsAction(options?: {
  limit?: number;
  cursor?: string;
  direction?: "next" | "previous";
}): Promise<
  | {
      jobs: CurationJob[];
      nextCursor: string | null;
      previousCursor: string | null;
      total: number;
    }
  | { error: string }
> {
  try {
    const auth = await requireAdminAction();
    if ("error" in auth) return auth;

    return await listCurationJobs(options);
  } catch (error) {
    console.error("[admin:listCurationJobsAction]", error);
    return {
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}

export async function dispatchCurationJobAction(
  jobId: string,
): Promise<QueuedJobResult | { error: string }> {
  try {
    const auth = await requireAdminAction();
    if ("error" in auth) return auth;

    const job = await getCurationJob(jobId);
    if (job.status !== "pending") {
      return { error: "Only queued jobs can be dispatched" };
    }

    const result = await dispatchQueuedJob(
      job.id,
      "Job dispatch request accepted.",
    );
    revalidatePath("/admin/jobs");
    revalidatePath(`/admin/jobs/${jobId}`);
    return result;
  } catch (error) {
    console.error("[admin:dispatchCurationJobAction]", error);
    return {
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}

export async function cancelCurationJobAction(
  jobId: string,
): Promise<{ cancelled: true } | { error: string }> {
  try {
    const auth = await requireAdminAction();
    if ("error" in auth) return auth;
    if (!isUuid(jobId)) return { error: "Invalid job ID" };

    const job = await getCurationJob(jobId);
    if (job.status !== "pending" && job.status !== "running") {
      return { error: "Only active jobs can be cancelled" };
    }

    await cancelCurationJob(jobId, "Cancelled by admin");
    void logAdminAction({
      adminUserId: auth.user.id,
      adminEmail: auth.user.email ?? auth.user.id,
      action: "curation_job_cancelled",
      metadata: { jobId },
    });

    revalidatePath("/admin");
    revalidatePath("/admin/jobs");
    revalidatePath(`/admin/jobs/${jobId}`);
    return { cancelled: true };
  } catch (error) {
    console.error("[admin:cancelCurationJobAction]", error);
    return {
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}

export async function getCurationJobDetailAction(
  jobId: string,
): Promise<{ detail: CurationJobDetail } | { error: string }> {
  try {
    const auth = await requireAdminAction();
    if ("error" in auth) return auth;

    return { detail: await getCurationJobDetail(jobId) };
  } catch (error) {
    console.error("[admin:getCurationJobDetailAction]", error);
    return {
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}

async function dispatchQueuedJob(
  jobId: string,
  successMessage: string,
): Promise<QueuedJobResult> {
  try {
    await dispatchCurationJob(jobId);
    try {
      await markCurationJobDispatched(jobId);
    } catch (error) {
      console.error(
        "[admin:dispatchCurationJobAction:mark-dispatched]",
        sanitizeDispatchError(error),
      );
    }
    return queuedJobResult(jobId, successMessage, "dispatched");
  } catch (error) {
    const message = sanitizeDispatchError(error);
    try {
      await recordCurationDispatchFailure(jobId, message);
    } catch (persistError) {
      console.error(
        "[admin:dispatchCurationJobAction:persist-failure]",
        sanitizeDispatchError(persistError),
      );
    }

    return queuedJobResult(
      jobId,
      `${successMessage} Dispatch failed: ${message} The job is marked failed and will receive one automatic retry when the worker is available.`,
      "failed",
    );
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function queuedJobResult(
  jobId: string,
  message: string,
  dispatchStatus: CurationDispatchStatus,
): QueuedJobResult {
  return {
    jobId,
    detailPath: `/admin/jobs/${jobId}`,
    queued: true,
    dispatchStatus,
    message,
  };
}
