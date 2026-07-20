import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CurationJob,
  CurationJobTarget,
} from "@/lib/services/curation-jobs";
import type { CurationTargetProgressEvent } from "@/lib/types/curation";

const mocks = vi.hoisted(() => ({
  runEnrich: vi.fn(),
  enqueueAutomaticRetry: vi.fn(),
  finalizeCurationJob: vi.fn(),
  heartbeatCurationJob: vi.fn(),
  listCurationJobTargets: vi.fn(),
  updateCurationJobTarget: vi.fn(),
  createServiceClient: vi.fn(),
  exportJobRunLog: vi.fn(),
  renderRunLogHtml: vi.fn(),
  uploadRunLogSnapshot: vi.fn(),
}));

vi.mock("../curation-operations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../curation-operations")>();
  return { ...actual, runEnrich: mocks.runEnrich };
});
vi.mock("@/lib/services/curation-jobs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/curation-jobs")>();
  return {
    ...actual,
    enqueueAutomaticRetry: mocks.enqueueAutomaticRetry,
    finalizeCurationJob: mocks.finalizeCurationJob,
    heartbeatCurationJob: mocks.heartbeatCurationJob,
    listCurationJobTargets: mocks.listCurationJobTargets,
    updateCurationJobTarget: mocks.updateCurationJobTarget,
  };
});
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock("@/lib/services/runlog-export", () => ({
  exportJobRunLog: mocks.exportJobRunLog,
}));
vi.mock("@/lib/runlog", () => ({
  renderRunLogHtml: mocks.renderRunLogHtml,
}));
vi.mock("@/lib/services/runlog-storage", () => ({
  uploadRunLogSnapshot: mocks.uploadRunLogSnapshot,
}));

import { runJob, sanitizeJobError } from "../job-runner";

describe("durable curation job runner", () => {
  let targets: CurationJobTarget[];

  beforeEach(() => {
    vi.clearAllMocks();
    targets = [target()];
    mocks.listCurationJobTargets.mockImplementation(async () => targets);
    mocks.heartbeatCurationJob.mockResolvedValue(true);
    mocks.finalizeCurationJob.mockResolvedValue(true);
    mocks.enqueueAutomaticRetry.mockResolvedValue(null);
    mocks.createServiceClient.mockReturnValue(mockSupabase());
    mocks.runEnrich.mockResolvedValue(operationResult("succeeded"));
    mocks.exportJobRunLog.mockResolvedValue({ run: { id: "job-1" } });
    mocks.renderRunLogHtml.mockReturnValue(
      "<!doctype html><title>Run log</title>",
    );
    mocks.uploadRunLogSnapshot.mockResolvedValue(undefined);
    mocks.updateCurationJobTarget.mockImplementation(
      async (_jobId, targetId, patch) => {
        targets = targets.map((item) =>
          item.target_id === targetId ? { ...item, ...patch } : item,
        );
      },
    );
  });

  it("completes when every target fails and does not create an automatic retry", async () => {
    mocks.runEnrich.mockImplementation(async (config) => {
      await emit(config.onTargetProgress, {
        status: "failed",
        error: "Provider did not return usable content",
        phaseResults: [
          {
            phase: "descriptions",
            status: "failed",
            changedFields: [],
            durationMs: 25,
            error: "Provider did not return usable content",
          },
        ],
      });
      return operationResult("failed");
    });

    const summary = await runJob(job({ trigger: "cron" }), "worker-token");

    expect(summary).toMatchObject({ success: 0, skipped: 0, failed: 1 });
    expect(mocks.finalizeCurationJob).toHaveBeenCalledWith(
      "job-1",
      "worker-token",
      expect.objectContaining({ status: "completed", failed_count: 1 }),
    );
    expect(mocks.enqueueAutomaticRetry).not.toHaveBeenCalled();
  });

  it("completes a zero-target scheduled run without calling enrichment providers", async () => {
    targets = [];

    const summary = await runJob(
      job({ trigger: "cron", target_total: 0 }),
      "worker-token",
    );

    expect(mocks.runEnrich).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ success: 0, skipped: 0, failed: 0 });
    expect(mocks.finalizeCurationJob).toHaveBeenCalledWith(
      "job-1",
      "worker-token",
      expect.objectContaining({
        status: "completed",
        target_total: 0,
        succeeded_count: 0,
        skipped_count: 0,
        failed_count: 0,
      }),
    );
  });

  it("archives a snapshot after a completed job is finalized", async () => {
    await runJob(job(), "worker-token");

    expect(mocks.uploadRunLogSnapshot).toHaveBeenCalledWith(
      "job-1",
      "<!doctype html><title>Run log</title>",
    );
  });

  it("archives a snapshot after a failed job is finalized", async () => {
    mocks.runEnrich.mockRejectedValue(new Error("Provider unavailable"));

    await runJob(
      job({ trigger: "automatic_retry", attempt: 2 }),
      "worker-token",
    );

    expect(mocks.uploadRunLogSnapshot).toHaveBeenCalledWith(
      "job-1",
      "<!doctype html><title>Run log</title>",
    );
  });

  it("keeps the job result unchanged when snapshot upload fails", async () => {
    targets = [target({ status: "succeeded" })];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.uploadRunLogSnapshot.mockRejectedValueOnce(
      new Error("Storage unavailable"),
    );

    const summary = await runJob(job(), "worker-token");

    expect(summary).toMatchObject({ success: 1, skipped: 0, failed: 0 });
    expect(console.error).toHaveBeenCalledWith(
      "[curation-worker:runlog]",
      "Storage unavailable",
    );
  });

  it("creates one immediate linked retry when a cron orchestration attempt fails", async () => {
    const cronJob = job({ trigger: "cron", attempt: 1 });
    mocks.runEnrich.mockRejectedValue(new Error("Database connection lost"));

    await runJob(cronJob, "worker-token");

    expect(mocks.finalizeCurationJob).toHaveBeenCalledWith(
      cronJob.id,
      "worker-token",
      expect.objectContaining({
        status: "failed",
        job_error: "Database connection lost",
      }),
    );
    expect(mocks.enqueueAutomaticRetry).toHaveBeenCalledOnce();
    expect(mocks.enqueueAutomaticRetry).toHaveBeenCalledWith(cronJob);
  });

  it("does not create another retry after a failed automatic retry", async () => {
    const failedJob = job({
      trigger: "automatic_retry",
      attempt: 2,
      parent_job_id: "job-parent",
    });
    mocks.runEnrich.mockRejectedValue(new Error("Orchestration stopped"));

    await runJob(failedJob, "worker-token");

    expect(mocks.enqueueAutomaticRetry).not.toHaveBeenCalled();
  });

  it("rejects a historical brand target without running enrichment", async () => {
    targets = [
      target({
        target_type: "brand",
        target_id: "legacy-brand-1",
        brand_slug: "legacy-brand",
      }),
    ];

    const summary = await runJob(
      job({ trigger: "automatic_retry", attempt: 2 }),
      "worker-token",
    );

    expect(mocks.runEnrich).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ failed: 1 });
    expect(mocks.finalizeCurationJob).toHaveBeenCalledWith(
      "job-1",
      "worker-token",
      expect.objectContaining({
        status: "failed",
        job_error: expect.stringContaining(
          "Brand-target enrichment jobs are retired",
        ),
      }),
    );
  });

  it("creates one retry for an orchestration failure from an admin run", async () => {
    const failedJob = job({ trigger: "admin" });
    mocks.runEnrich.mockRejectedValue(new Error("Orchestration stopped"));

    await runJob(failedJob, "worker-token");

    expect(mocks.enqueueAutomaticRetry).toHaveBeenCalledOnce();
    expect(mocks.enqueueAutomaticRetry).toHaveBeenCalledWith(failedJob);
  });

  it("does not finalize with a stale worker token after the lease is lost", async () => {
    mocks.runEnrich.mockImplementation(async (config) => {
      mocks.heartbeatCurationJob.mockResolvedValueOnce(false);
      await emit(config.onTargetProgress, { status: "succeeded" });
      return operationResult("succeeded");
    });
    mocks.finalizeCurationJob.mockResolvedValue(false);

    const summary = await runJob(job({ trigger: "cron" }), "stale-token");

    expect(summary.failed).toBe(1);
    expect(mocks.enqueueAutomaticRetry).not.toHaveBeenCalled();
  });

  it("persists phase progress and sanitized terminal errors", async () => {
    mocks.runEnrich.mockImplementation(async (config) => {
      await emit(config.onTargetProgress, {
        status: "running",
        currentPhase: "links",
        phaseResults: [
          {
            phase: "clean",
            status: "failed",
            changedFields: ["name"],
            durationMs: 8,
            error: "Bearer phase-secret",
          },
        ],
      });
      await emit(config.onTargetProgress, {
        status: "failed",
        error: "Bearer secret-token-value",
      });
      return operationResult("failed");
    });

    await runJob(job(), "worker-token");

    expect(mocks.updateCurationJobTarget).toHaveBeenCalledWith(
      "job-1",
      "brand-1",
      expect.objectContaining({
        status: "running",
        current_phase: "links",
        phase_results: [
          expect.objectContaining({ error: "Bearer [REDACTED]" }),
        ],
      }),
    );
    expect(mocks.updateCurationJobTarget).toHaveBeenLastCalledWith(
      "job-1",
      "brand-1",
      expect.objectContaining({ status: "failed", error: "Bearer [REDACTED]" }),
    );
  });

  it("reruns complete failed submissions while skipping deleted and approved targets", async () => {
    targets = [
      target({
        target_type: "submission",
        target_id: "submission-deleted",
        brand_slug: null,
      }),
      target({
        id: "target-row-2",
        target_type: "submission",
        target_id: "submission-enriched",
        brand_slug: null,
      }),
      target({
        id: "target-row-3",
        target_type: "submission",
        target_id: "submission-approved",
        brand_slug: null,
      }),
    ];
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "brand_submissions") {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({
                data: [
                  {
                    id: "submission-enriched",
                    status: "pending",
                    brand_id: null,
                    hero_image_url: "https://example.com/already-done.jpg",
                    enriched_data: {
                      description: "Already done",
                      hero_image_url: "https://example.com/already-done.jpg",
                      product_type: "crafts",
                    },
                  },
                  {
                    id: "submission-approved",
                    status: "approved",
                    brand_id: "brand-approved",
                    enriched_data: null,
                  },
                ],
                error: null,
              })),
            })),
          };
        }

        if (table === "curation_job_targets") {
          return {
            update: vi.fn((patch) =>
              targetMutation(
                patch,
                () => targets,
                (next) => {
                  targets = next;
                },
              ),
            ),
          };
        }

        return { update: vi.fn(() => chain()) };
      }),
    });
    mocks.runEnrich.mockImplementation(async (config) => {
      await emit(config.onTargetProgress, {
        targetId: "submission-enriched",
        targetType: "submission",
        status: "succeeded",
      });
      return operationResult("succeeded");
    });

    const summary = await runJob(
      job({
        trigger: "manual_rerun",
        params: { submissionIds: targets.map((item) => item.target_id) },
      }),
      "worker-token",
    );

    expect(mocks.runEnrich).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "submissions",
        submissionIds: ["submission-enriched"],
      }),
      expect.anything(),
    );
    expect(summary).toMatchObject({ success: 1, skipped: 2, failed: 0 });
    expect(targets.map((item) => item.error)).toEqual(
      expect.arrayContaining([
        "Submission was deleted before the rerun",
        "Submission was approved or changed before the rerun",
      ]),
    );
  });

  it("redacts credentials from stored job errors", () => {
    expect(sanitizeJobError("Bearer abc.def-123")).toBe("Bearer [REDACTED]");
    expect(sanitizeJobError("eyJheader.eyJpayload.signature")).toBe(
      "[REDACTED_JWT]",
    );
    expect(sanitizeJobError("api_key=provider-secret")).toBe(
      "api_key=[REDACTED]",
    );
  });
});

async function emit(
  callback:
    ((event: CurationTargetProgressEvent) => void | Promise<void>) | undefined,
  overrides: Partial<CurationTargetProgressEvent>,
) {
  await callback?.({
    targetId: "brand-1",
    targetType: "submission",
    slug: "taipei-maker",
    name: "台北工坊",
    status: "running",
    ...overrides,
  });
}

function operationResult(status: "succeeded" | "failed") {
  return {
    processed: 1,
    updated: status === "succeeded" ? 1 : 0,
    skipped: 0,
    errors:
      status === "failed" ? ["Provider did not return usable content"] : [],
    brandOutcomes: [
      {
        slug: "taipei-maker",
        name: "台北工坊",
        status,
        ...(status === "failed"
          ? { error: "Provider did not return usable content" }
          : {}),
      },
    ],
  };
}

function job(overrides: Partial<CurationJob> = {}): CurationJob {
  return {
    id: "job-1",
    operation: "enrich",
    status: "running",
    trigger: "admin",
    attempt: 1,
    parent_job_id: null,
    params: { submissionIds: ["brand-1"], target: "submissions" },
    dry_run: false,
    progress: null,
    result: null,
    started_by: "admin@example.com",
    created_at: "2026-07-13T00:00:00.000Z",
    started_at: "2026-07-13T00:00:01.000Z",
    completed_at: null,
    scheduled_for: null,
    run_after: "2026-07-13T00:00:00.000Z",
    dedupe_key: null,
    heartbeat_at: "2026-07-13T00:00:01.000Z",
    worker_token: "worker-token",
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

function target(overrides: Partial<CurationJobTarget> = {}): CurationJobTarget {
  return {
    id: "target-row-1",
    job_id: "job-1",
    target_type: "submission",
    target_id: "brand-1",
    brand_name: "台北工坊",
    brand_slug: null,
    status: "pending",
    current_phase: null,
    phase_results: [],
    changed_fields: [],
    error: null,
    started_at: null,
    completed_at: null,
    duration_ms: null,
    created_at: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

function mockSupabase() {
  return {
    from: vi.fn(() => ({
      update: vi.fn(() => chain()),
    })),
  };
}

function chain(): Record<string, unknown> {
  const result: Record<string, unknown> = {
    eq: vi.fn(() => result),
    in: vi.fn(async () => ({ error: null })),
    then: (resolve: (value: { error: null }) => unknown) =>
      Promise.resolve({ error: null }).then(resolve),
  };
  return result;
}

function targetMutation(
  patch: Partial<CurationJobTarget>,
  getTargets: () => CurationJobTarget[],
  setTargets: (targets: CurationJobTarget[]) => void,
) {
  const filters = new Map<string, unknown>();
  const builder = {
    eq(field: string, value: unknown) {
      filters.set(field, value);
      return builder;
    },
    async in(field: string, values: unknown[]) {
      setTargets(
        getTargets().map((item) => {
          const matchesEquals = [...filters].every(
            ([key, value]) => item[key as keyof CurationJobTarget] === value,
          );
          const matchesIn = values.includes(
            item[field as keyof CurationJobTarget],
          );
          return matchesEquals && matchesIn ? { ...item, ...patch } : item;
        }),
      );
      return { error: null };
    },
  };
  return builder;
}
