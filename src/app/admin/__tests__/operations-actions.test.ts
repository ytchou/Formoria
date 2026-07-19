import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CurationJob,
  CurationJobDetail,
} from "@/lib/services/curation-jobs";

const requireAdminAction = vi.fn();
const enqueueAdminCurationJob = vi.fn();
const enqueueManualRerun = vi.fn();
const getCurationJobDetail = vi.fn();
const listCurationJobs = vi.fn();
const getCurationJob = vi.fn();
const markCurationJobDispatched = vi.fn();
const markCurationJobDispatchPending = vi.fn();
const recordCurationDispatchFailure = vi.fn();
const dispatchCurationJob = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/require-admin", () => ({ requireAdminAction }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/services/curation-jobs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/curation-jobs")>();
  return {
    ...actual,
    enqueueAdminCurationJob,
    enqueueManualRerun,
    getCurationJob,
    getCurationJobDetail,
    listCurationJobs,
    markCurationJobDispatched,
    markCurationJobDispatchPending,
    recordCurationDispatchFailure,
  };
});
vi.mock('@/lib/services/curation-dispatch', () => ({
  dispatchCurationJob,
  sanitizeDispatchError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

describe("curation server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminAction.mockResolvedValue({
      user: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        email: "admin@example.com",
      },
    });
    enqueueAdminCurationJob.mockResolvedValue(job());
    enqueueManualRerun.mockResolvedValue(
      job({ id: "rerun-job", trigger: "manual_rerun" }),
    );
    listCurationJobs.mockResolvedValue({
      jobs: [job()],
      nextCursor: null,
      previousCursor: null,
      total: 1,
    });
    getCurationJobDetail.mockResolvedValue(detail());
    getCurationJob.mockResolvedValue(job());
    markCurationJobDispatched.mockResolvedValue(undefined);
    markCurationJobDispatchPending.mockResolvedValue(undefined);
    recordCurationDispatchFailure.mockResolvedValue(undefined);
    dispatchCurationJob.mockResolvedValue({ accepted: true, status: 'started' });
  });

  it("queues one durable job without running it inside the request", async () => {
    const { startCurationJobAction } = await import("../operations/actions");
    const submissionIds = Array.from(
      { length: 23 },
      (_, index) =>
        `6ba7b810-9dad-11d1-80b4-${String(index + 1).padStart(12, "0")}`,
    );

    const result = await startCurationJobAction(
      "enrich",
      { submissionIds },
      false,
    );

    expect(enqueueAdminCurationJob).toHaveBeenCalledOnce();
    expect(enqueueAdminCurationJob).toHaveBeenCalledWith({
      params: { submissionIds },
      dryRun: false,
      startedBy: "admin@example.com",
    });
    expect(result).toEqual({
      jobId: "job-1",
      detailPath: "/admin/jobs/job-1",
      queued: true,
      dispatchStatus: "dispatched",
      message:
        "Data job created and dispatching now.",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/jobs");
  });

  it("rejects removed operations before enqueueing", async () => {
    const { startCurationJobAction } = await import("../operations/actions");

    await expect(
      startCurationJobAction("clean-names", {}, false),
    ).resolves.toEqual({
      error: "Operation removed — use enrich instead",
    });
    expect(enqueueAdminCurationJob).not.toHaveBeenCalled();
  });

  it("keeps a queued job durable when immediate dispatch fails", async () => {
    dispatchCurationJob.mockRejectedValueOnce(new Error("worker unavailable"));

    const { startCurationJobAction } = await import("../operations/actions");
    const result = await startCurationJobAction("enrich", {}, false);

    expect(result).toMatchObject({
      jobId: "job-1",
      queued: true,
      dispatchStatus: "failed",
    });
    expect(result).toMatchObject({
      message: expect.stringContaining("worker unavailable"),
    });
    expect(recordCurationDispatchFailure).toHaveBeenCalledWith(
      "job-1",
      "worker unavailable",
    );
  });

  it("queues a linked manual rerun and returns its detail route", async () => {
    const { rerunCurationJobAction } = await import("../operations/actions");

    const result = await rerunCurationJobAction("job-1");

    expect(enqueueManualRerun).toHaveBeenCalledWith(
      "job-1",
      "admin@example.com",
    );
    expect(result).toMatchObject({
      jobId: "rerun-job",
      detailPath: "/admin/jobs/rerun-job",
      queued: true,
      dispatchStatus: "dispatched",
      message:
        "Rerun job created for failed or unfinished brands, dispatching now.",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/jobs/job-1");
  });

  it("returns job history and detail only after admin authorization", async () => {
    const { getCurationJobDetailAction, listCurationJobsAction } =
      await import("../operations/actions");

    await expect(listCurationJobsAction()).resolves.toEqual({
      jobs: [job()],
      nextCursor: null,
      previousCursor: null,
      total: 1,
    });
    await expect(getCurationJobDetailAction("job-1")).resolves.toEqual({
      detail: detail(),
    });
    expect(requireAdminAction).toHaveBeenCalledTimes(2);
  });
});

function job(overrides: Partial<CurationJob> = {}): CurationJob {
  return {
    id: "job-1",
    operation: "enrich",
    status: "pending",
    trigger: "admin",
    attempt: 1,
    parent_job_id: null,
    params: null,
    dry_run: false,
    progress: null,
    result: null,
    started_by: "admin@example.com",
    created_at: "2026-07-13T00:00:00.000Z",
    started_at: null,
    completed_at: null,
    scheduled_for: null,
    run_after: "2026-07-13T00:00:00.000Z",
    dedupe_key: null,
    heartbeat_at: null,
    worker_token: null,
    job_error: null,
    current_target_id: null,
    current_phase: null,
    target_total: 1,
    succeeded_count: 0,
    skipped_count: 0,
    failed_count: 0,
    dispatch_status: "pending",
    dispatch_error: null,
    dispatched_at: null,
    ...overrides,
  };
}

function detail(): CurationJobDetail {
  return { job: job(), targets: [], parent: null, children: [] };
}
