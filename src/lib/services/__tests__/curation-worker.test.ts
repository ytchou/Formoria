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
  return { id } as CurationJob;
}

function summary(overrides: Partial<EnrichmentSummary> = {}): EnrichmentSummary {
  return { ...overrides } as EnrichmentSummary;
}

function makeDeps(
  queue: Array<CurationJob | null>,
  runJob: CurationWorkerDeps["runJob"] = async () => summary(),
) {
  const claims = [...queue];
  const deps = {
    recoverStaleJobs: vi.fn(async () => []),
    ensureAutomaticRetries: vi.fn(async () => []),
    enqueueScheduledSubmissionJob: vi.fn(async () => null),
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
      deps,
    });

    expect(correlationIds).toHaveLength(2);
    expect(correlationIds[0]).not.toBeNull();
    expect(correlationIds[1]).not.toBeNull();
    expect(correlationIds[0]).not.toBe(correlationIds[1]);
  });
});
