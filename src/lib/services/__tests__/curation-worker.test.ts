import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuditContext } from "@/lib/audit/context";
import type { CurationJob } from "@/lib/services/curation-jobs";
import {
  runScheduledCuration,
  type CurationWorkerDeps,
} from "@/lib/services/curation-worker";
import type { EnrichmentSummary } from "@/lib/services/enrichment-logger";

const START = new Date("2026-10-01T04:00:00Z");

function job(id: string): CurationJob {
  const at = START.toISOString();
  return {
    id,
    attempt: 1,
    cancelled_count: 0,
    completed_at: null,
    created_at: at,
    current_phase: null,
    current_target_id: null,
    dedupe_key: null,
    dispatch_error: null,
    dispatch_status: "dispatched",
    dispatched_at: at,
    dry_run: false,
    failed_count: 0,
    heartbeat_at: at,
    job_error: null,
    operation: "enrich",
    params: { target: "submissions" },
    parent_job_id: null,
    progress: null,
    result: null,
    run_after: at,
    scheduled_for: at,
    skipped_count: 0,
    started_at: at,
    started_by: "cron",
    status: "running",
    succeeded_count: 0,
    target_total: 1,
    trigger: "cron",
    worker_token: null,
  };
}

function summary(overrides: Partial<EnrichmentSummary> = {}): EnrichmentSummary {
  return {
    success: 1,
    skipped: 0,
    failed: 0,
    failedBrands: [],
    durationMs: 1_000,
    providerFailed: 0,
    ...overrides,
  };
}

function makeDeps(
  queue: Array<CurationJob | null>,
  runJob: CurationWorkerDeps["runJob"] = async () => summary(),
) {
  const claims = [...queue];
  const deps = {
    recoverStaleJobs: vi.fn(async () => []),
    ensureAutomaticRetries: vi.fn(async () => []),
    enqueueScheduledSubmissionJob: vi.fn(async () => job("scheduled")),
    claimNextCurationJob: vi.fn(async () => claims.shift() ?? null),
    runJob: vi.fn(runJob),
  } satisfies CurationWorkerDeps;
  return deps;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runScheduledCuration", () => {
  it("runScheduledCuration_stops_claiming_after_soft_deadline", async () => {
    const softDeadlineAt = START.getTime() + 60_000;
    const deps = makeDeps([job("a"), job("b"), job("c")], async () => {
      // The job outlives the soft deadline.
      vi.setSystemTime(softDeadlineAt + 1);
      return summary();
    });

    const result = await runScheduledCuration(START, {
      softDeadlineAt,
      onJobClaimed: () => {},
      onJobSettled: () => {},
      deps,
    });

    expect(result.processed).toBe(1);
    expect(result.deadlineHit).toBe(true);
    expect(deps.runJob).toHaveBeenCalledTimes(1);
    // Only the claim that fed the first run; none after it started.
    expect(deps.claimNextCurationJob).toHaveBeenCalledTimes(1);
  });

  it("runScheduledCuration_drains_until_queue_empty_before_deadline", async () => {
    const deps = makeDeps([job("a"), job("b"), null]);

    const result = await runScheduledCuration(START, {
      softDeadlineAt: START.getTime() + 60_000,
      onJobClaimed: () => {},
      onJobSettled: () => {},
      deps,
    });

    expect(result.processed).toBe(2);
    expect(result.deadlineHit).toBe(false);
    expect(deps.recoverStaleJobs).toHaveBeenCalledTimes(1);
    expect(deps.ensureAutomaticRetries).toHaveBeenCalledTimes(1);
  });

  it("runScheduledCuration_reports_each_claimed_job", async () => {
    const deps = makeDeps([job("a"), job("b"), null]);
    const claimed: string[] = [];

    await runScheduledCuration(START, {
      softDeadlineAt: START.getTime() + 60_000,
      onJobClaimed: (claimedJob) => claimed.push(claimedJob.id),
      onJobSettled: () => {},
      deps,
    });

    expect(claimed).toEqual(["a", "b"]);
  });

  it("runScheduledCuration_stops_when_breaker_trips", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps([job("a"), job("b"), null], async () =>
      summary({ breakerTripped: true }),
    );

    const result = await runScheduledCuration(START, {
      softDeadlineAt: START.getTime() + 60_000,
      onJobClaimed: () => {},
      onJobSettled: () => {},
      deps,
    });

    expect(result.processed).toBe(1);
    expect(result.deadlineHit).toBe(false);
    expect(deps.claimNextCurationJob).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("runScheduledCuration_gives_each_job_its_own_correlation_id", async () => {
    const correlationIds: Array<string | null> = [];
    const deps = makeDeps([job("a"), job("b"), null], async () => {
      correlationIds.push(getAuditContext().correlationId);
      return summary();
    });

    await runScheduledCuration(START, {
      softDeadlineAt: START.getTime() + 60_000,
      onJobClaimed: () => {},
      onJobSettled: () => {},
      deps,
    });

    expect(correlationIds).toHaveLength(2);
    expect(correlationIds[0]).not.toBeNull();
    expect(correlationIds[1]).not.toBeNull();
    expect(correlationIds[0]).not.toBe(correlationIds[1]);
  });

  it("runScheduledCuration_claims_nothing_when_soft_deadline_already_passed", async () => {
    const deps = makeDeps([job("a"), null]);

    const result = await runScheduledCuration(START, {
      softDeadlineAt: START.getTime() - 1,
      onJobClaimed: () => {},
      onJobSettled: () => {},
      deps,
    });

    expect(result.processed).toBe(0);
    expect(result.deadlineHit).toBe(true);
    expect(deps.claimNextCurationJob).not.toHaveBeenCalled();
    expect(deps.runJob).not.toHaveBeenCalled();
  });

  it("runScheduledCuration_reports_each_settled_job", async () => {
    const events: string[] = [];
    const deps = makeDeps([job("a"), job("b"), null], async (running) => {
      events.push(`run:${running.id}`);
      return summary();
    });

    await runScheduledCuration(START, {
      softDeadlineAt: START.getTime() + 60_000,
      onJobClaimed: (claimedJob) => events.push(`claim:${claimedJob.id}`),
      onJobSettled: (settledJob) => events.push(`settle:${settledJob.id}`),
      deps,
    });

    expect(events).toEqual([
      "claim:a",
      "run:a",
      "settle:a",
      "claim:b",
      "run:b",
      "settle:b",
    ]);
  });

  it("runScheduledCuration_reports_settled_when_job_rejects", async () => {
    const settled: string[] = [];
    const deps = makeDeps([job("a"), null], async () => {
      throw new Error("job failed");
    });

    await expect(
      runScheduledCuration(START, {
        softDeadlineAt: START.getTime() + 60_000,
        onJobClaimed: () => {},
        onJobSettled: (settledJob) => settled.push(settledJob.id),
        deps,
      }),
    ).rejects.toThrow("job failed");

    expect(settled).toEqual(["a"]);
  });
});
