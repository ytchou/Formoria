import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurationJob } from "@/lib/services/curation-jobs";

const mocks = vi.hoisted(() => ({
  claimNextCurationJob: vi.fn(),
  enqueueScheduledSubmissionJob: vi.fn(),
  ensureAutomaticRetries: vi.fn(),
  recoverStaleJobs: vi.fn(),
  runJob: vi.fn(),
}));

vi.mock("@/lib/services/curation-jobs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/curation-jobs")>();
  return {
    ...actual,
    claimNextCurationJob: mocks.claimNextCurationJob,
    enqueueScheduledSubmissionJob: mocks.enqueueScheduledSubmissionJob,
    ensureAutomaticRetries: mocks.ensureAutomaticRetries,
    recoverStaleJobs: mocks.recoverStaleJobs,
  };
});
vi.mock("@/lib/services/job-runner", () => ({ runJob: mocks.runJob }));

import {
  getTaipeiScheduleSlot,
  runScheduledCuration,
} from "../curation-worker";

describe("curation worker scheduling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.recoverStaleJobs.mockResolvedValue([]);
    mocks.ensureAutomaticRetries.mockResolvedValue([]);
    mocks.runJob.mockResolvedValue({});
  });

  it.each([
    ["2026-07-13T15:59:59.000Z", "2026-07-13T10:00:00.000Z"],
    ["2026-07-13T16:00:00.000Z", "2026-07-13T16:00:00.000Z"],
    ["2026-07-13T21:59:59.000Z", "2026-07-13T16:00:00.000Z"],
    ["2026-07-13T22:00:00.000Z", "2026-07-13T22:00:00.000Z"],
  ])("maps %s to the Taipei six-hour slot %s", (now, expected) => {
    expect(getTaipeiScheduleSlot(new Date(now)).toISOString()).toBe(expected);
  });

  it("creates and processes the canonical scheduled job when the queue is empty", async () => {
    const scheduledJob = job();
    mocks.enqueueScheduledSubmissionJob.mockResolvedValue(scheduledJob);
    mocks.claimNextCurationJob
      .mockResolvedValueOnce(scheduledJob)
      .mockResolvedValueOnce(null);

    const result = await runScheduledCuration(
      new Date("2026-07-13T16:12:00.000Z"),
    );

    expect(mocks.enqueueScheduledSubmissionJob).toHaveBeenCalledWith(
      new Date("2026-07-13T16:00:00.000Z"),
    );
    expect(mocks.runJob).toHaveBeenCalledWith(scheduledJob, expect.any(String));
    expect(result).toEqual({ processed: 1, scheduledJob });
  });

  it("enqueues the current slot before processing queued work", async () => {
    const first = job({ id: "job-1" });
    const second = job({
      id: "job-2",
      trigger: "automatic_retry",
      attempt: 2,
      parent_job_id: first.id,
    });
    const scheduled = job({ id: "scheduled-job", trigger: "cron" });
    const events: string[] = [];
    mocks.recoverStaleJobs.mockImplementation(async () => {
      events.push("recover");
      return [];
    });
    mocks.ensureAutomaticRetries.mockImplementation(async () => {
      events.push("retry");
      return [];
    });
    mocks.enqueueScheduledSubmissionJob.mockImplementation(async () => {
      events.push("schedule");
      return scheduled;
    });
    mocks.claimNextCurationJob
      .mockImplementationOnce(async () => {
        events.push("claim-1");
        return first;
      })
      .mockImplementationOnce(async () => {
        events.push("claim-2");
        return second;
      })
      .mockImplementationOnce(async () => {
        events.push("claim-empty");
        return null;
      });
    mocks.runJob
      .mockImplementationOnce(async (claimed: CurationJob) => {
        events.push(`run-${claimed.id}`);
      })
      .mockImplementationOnce(async (claimed: CurationJob) => {
        events.push(`run-${claimed.id}`);
      });

    await expect(
      runScheduledCuration(new Date("2026-07-13T16:12:00.000Z")),
    ).resolves.toEqual({
      processed: 2,
      scheduledJob: scheduled,
    });
    expect(mocks.enqueueScheduledSubmissionJob).toHaveBeenCalledWith(
      new Date("2026-07-13T16:00:00.000Z"),
    );
    expect(events).toEqual([
      "recover",
      "retry",
      "schedule",
      "claim-1",
      "run-job-1",
      "claim-2",
      "run-job-2",
      "claim-empty",
    ]);
  });
});

function job(overrides: Partial<CurationJob> = {}): CurationJob {
  return {
    id: "job-1",
    operation: "enrich",
    status: "pending",
    trigger: "cron",
    attempt: 1,
    parent_job_id: null,
    params: { target: "submissions" },
    dry_run: false,
    progress: null,
    result: null,
    started_by: "railway-cron",
    created_at: "2026-07-13T16:00:00.000Z",
    started_at: null,
    completed_at: null,
    scheduled_for: "2026-07-13T16:00:00.000Z",
    run_after: "2026-07-13T16:00:00.000Z",
    dedupe_key: "submission-enrichment:2026-07-13T16:00:00.000Z",
    heartbeat_at: null,
    worker_token: null,
    job_error: null,
    current_target_id: null,
    current_phase: null,
    target_total: 0,
    succeeded_count: 0,
    skipped_count: 0,
    failed_count: 0,
    dispatch_status: "pending",
    dispatch_error: null,
    dispatched_at: null,
    ...overrides,
  };
}
