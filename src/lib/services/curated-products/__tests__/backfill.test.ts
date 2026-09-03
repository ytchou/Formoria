import { describe, expect, it, vi } from "vitest";

import {
  requestCuratedProductBackfill,
  type CuratedProductBackfillDeps,
} from "../backfill";

const REQUESTER = {
  id: "8a2f2b6c-9d4e-4a1b-8f3c-6b5d2e9a7c10",
  email: "curator@formoria.com",
};
const BRAND_A = "1f1a1b1c-1d1e-4f10-8a11-1b1c1d1e1f10";
const BRAND_B = "2f2a2b2c-2d2e-4f20-8a22-2b2c2d2e2f20";

function deps(
  overrides: Partial<CuratedProductBackfillDeps> = {},
): CuratedProductBackfillDeps {
  return {
    requestRefresh: vi.fn(async (brandId: string) => ({
      submissionId: `submission-for-${brandId}`,
    })),
    enqueueJob: vi.fn(async () => ({ id: "job-1" })),
    rollbackSubmissions: vi.fn(async () => ({
      deletedCount: 0,
      cleanupFailed: false,
    })),
    ...overrides,
  } as unknown as CuratedProductBackfillDeps;
}

describe("requestCuratedProductBackfill", () => {
  it("queues the products phase WITH its hard dependencies", async () => {
    // After DEV-1644 wave-A/B collapse, `acquire` replaces `links` +
    // `site_identity` as the transitive dependency of `products`.
    const injected = deps();

    const result = await requestCuratedProductBackfill(
      [BRAND_A],
      REQUESTER,
      injected,
    );

    expect(result.jobId).toBe("job-1");
    expect(injected.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          submissionIds: [`submission-for-${BRAND_A}`],
          phases: ["acquire", "products"],
        },
        dryRun: false,
        startedBy: REQUESTER.email,
      }),
    );
    // `steps` must stay absent: runEnrich resolves steps FIRST and lets them
    // beat phases, so a job carrying both silently widens to the whole group.
    const params = vi.mocked(injected.enqueueJob).mock.calls[0]?.[0].params as
      | Record<string, unknown>
      | undefined;
    expect(params && "steps" in params).toBe(false);
  });

  it("does not include retired phases (links, site_identity) in the backfill", async () => {
    const injected = deps();

    await requestCuratedProductBackfill([BRAND_A], REQUESTER, injected);

    const params = vi.mocked(injected.enqueueJob).mock.calls[0]?.[0].params as
      | Record<string, unknown>
      | undefined;
    const phases = params?.phases as string[];
    expect(phases).not.toContain("links");
    expect(phases).not.toContain("site_identity");
  });

  it("rolls the opened refreshes back when the enqueue throws", async () => {
    // The order cannot be swapped — the job needs its submissions to exist — so
    // a throw here strands every refresh this call opened. On the retry each
    // brand raises 23505, nothing new opens, and the function would report
    // "nothing to do" while the brands can never be refreshed again.
    const rollbackSubmissions = vi.fn(async () => ({
      deletedCount: 2,
      cleanupFailed: false,
    }));
    const injected = deps({
      enqueueJob: vi.fn(async () => {
        throw new Error("resolveTargets failed");
      }),
      rollbackSubmissions,
    });

    const result = await requestCuratedProductBackfill(
      [BRAND_A, BRAND_B],
      REQUESTER,
      injected,
    );

    expect(rollbackSubmissions).toHaveBeenCalledWith([
      `submission-for-${BRAND_A}`,
      `submission-for-${BRAND_B}`,
    ]);
    expect(result.jobId).toBeNull();
    expect(result.outcomes.map((outcome) => outcome.submissionId)).toEqual([
      null,
      null,
    ]);
    for (const outcome of result.outcomes) {
      expect(outcome.error).toContain("rolled back");
      expect(outcome.error).toContain("resolveTargets failed");
    }
  });

  it("keeps naming a stranded submission when the rollback itself fails", async () => {
    // Reporting `null` here would hide the row that is now blocking every
    // future refresh of that brand.
    const injected = deps({
      enqueueJob: vi.fn(async () => {
        throw new Error("enqueue failed");
      }),
      rollbackSubmissions: vi.fn(async () => {
        throw new Error("rollback failed");
      }),
    });

    const result = await requestCuratedProductBackfill(
      [BRAND_A],
      REQUESTER,
      injected,
    );

    expect(result.jobId).toBeNull();
    expect(result.outcomes[0]?.submissionId).toBe(
      `submission-for-${BRAND_A}`,
    );
    expect(result.outcomes[0]?.error).toContain("could NOT be rolled back");
  });

  it("never enqueues, and never rolls back, when no refresh opened", async () => {
    const rollbackSubmissions = vi.fn(async () => ({
      deletedCount: 0,
      cleanupFailed: false,
    }));
    const injected = deps({
      // Rejected with the RPC's own `{ message, code }` shape — Supabase does
      // not reject with an Error, which is why `describeRefreshError` exists.
      requestRefresh: vi.fn(() =>
        Promise.reject({
          message: "A refresh is already pending for this brand",
          code: "23505",
        }),
      ),
      rollbackSubmissions,
    });

    const result = await requestCuratedProductBackfill(
      [BRAND_A],
      REQUESTER,
      injected,
    );

    expect(result).toEqual({
      jobId: null,
      outcomes: [
        {
          brandId: BRAND_A,
          submissionId: null,
          error: "A refresh is already pending for this brand",
        },
      ],
    });
    expect(injected.enqueueJob).not.toHaveBeenCalled();
    expect(rollbackSubmissions).not.toHaveBeenCalled();
  });
});
