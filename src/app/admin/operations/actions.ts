"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/require-admin";
import {
  cancelCurationJob,
  enqueueAdminCurationJob,
  enqueueManualRerun,
  getCurationJob,
  getCurationJobCounts,
  getCurationJobDetail,
  markCurationJobDispatchPending,
  markCurationJobDispatched,
  recordCurationDispatchFailure,
  listCurationJobs,
  type CurationJob,
  type CurationDispatchStatus,
  type CurationJobDetail,
  type CurationJobParams,
  type CurationJobView,
} from "@/lib/services/curation-jobs";
import {
  dispatchCurationJob,
  sanitizeDispatchError,
} from "@/lib/services/curation-dispatch";

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
  view?: CurationJobView;
}): Promise<{ jobs: CurationJob[] } | { error: string }> {
  try {
    const auth = await requireAdminAction();
    if ("error" in auth) return auth;

    return { jobs: await listCurationJobs(options) };
  } catch (error) {
    console.error("[admin:listCurationJobsAction]", error);
    return {
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}

export async function getCurationJobCountsAction() {
  try {
    const auth = await requireAdminAction();
    if ("error" in auth) return auth;

    return { counts: await getCurationJobCounts() };
  } catch (error) {
    console.error("[admin:getCurationJobCountsAction]", error);
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

    const result = await dispatchQueuedJob(job.id, "Job dispatch request accepted.");
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

export async function retryCurationDispatchAction(
  jobId: string,
): Promise<QueuedJobResult | { error: string }> {
  try {
    const auth = await requireAdminAction();
    if ("error" in auth) return auth;

    const job = await getCurationJob(jobId);
    if (job.status !== "pending") {
      return { error: "Only queued jobs can retry dispatch" };
    }

    await markCurationJobDispatchPending(job.id);
    const result = await dispatchQueuedJob(job.id, "Job dispatch retry initiated.");
    revalidatePath("/admin/jobs");
    revalidatePath(`/admin/jobs/${jobId}`);
    return result;
  } catch (error) {
    console.error("[admin:retryCurationDispatchAction]", error);
    return {
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}

export async function dismissCurationJobAction(
  jobId: string,
): Promise<{ dismissed: true } | { error: string }> {
  try {
    const auth = await requireAdminAction();
    if ("error" in auth) return auth;

    const job = await getCurationJob(jobId);
    if (job.status !== "pending") {
      return { error: "Only pending jobs can be dismissed" };
    }

    await cancelCurationJob(jobId);

    revalidatePath("/admin/jobs");
    revalidatePath(`/admin/jobs/${jobId}`);
    return { dismissed: true };
  } catch (error) {
    console.error("[admin:dismissCurationJobAction]", error);
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
      `${successMessage} Dispatch failed: ${message} Retry dispatch from the jobs page.`,
      "failed",
    );
  }
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
