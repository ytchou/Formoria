import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuditContext } from "@/lib/audit/context";
import {
  drainJobQueue,
  runInCronScope,
  startStaleJobMaintenance,
} from "../curation-worker-loop";

afterEach(() => {
  vi.useRealTimers();
});

describe("curation worker audit correlation", () => {
  it("each drained job gets its own correlation id", async () => {
    const jobs: [{ id: string }, { id: string }] = [
      { id: "job-one" },
      { id: "job-two" },
    ];
    const correlationIds: Array<string | null> = [];
    let nextJobIndex = 0;

    await drainJobQueue({
      initialJob: jobs[0],
      workerToken: "worker-token-one",
      runJob: async () => {
        correlationIds.push(getAuditContext().correlationId);
      },
      claimNextJob: async () => {
        return jobs[++nextJobIndex] ?? null;
      },
    });

    expect(correlationIds[0]).not.toBeNull();
    expect(correlationIds[1]).not.toBeNull();
    expect(correlationIds[0]).not.toBe(correlationIds[1]);
  });

  it("the cron entry opens its own scope", async () => {
    let jobCorrelationId: string | null = null;
    let cronCorrelationId: string | null = null;

    await drainJobQueue({
      initialJob: { id: "job-one" },
      workerToken: "worker-token-one",
      runJob: async () => {
        jobCorrelationId = getAuditContext().correlationId;
      },
      claimNextJob: async () => null,
    });

    await runInCronScope(async () => {
      cronCorrelationId = getAuditContext().correlationId;
    });

    expect(jobCorrelationId).not.toBeNull();
    expect(cronCorrelationId).not.toBeNull();
    expect(cronCorrelationId).not.toBe(jobCorrelationId);
  });

  it("stale maintenance runs inside a scope", async () => {
    vi.useFakeTimers();
    let staleCorrelationId: string | null = null;

    startStaleJobMaintenance({
      recoverStaleJobs: async () => {
        staleCorrelationId = getAuditContext().correlationId;
      },
      onError: () => {},
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(staleCorrelationId).not.toBeNull();
  });
});
