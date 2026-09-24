import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/audit", () => ({
  auditedCall: vi
    .fn()
    .mockImplementation(
      (_spec: unknown, fn: (ctx: { summary: Record<string, unknown> }) => unknown) =>
        fn({ summary: {} }),
    ),
}));

import { executeProposal } from "../execute";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<Parameters<typeof executeProposal>[1]> = {}) {
  return {
    operatorEmail: "ops@formoria.com",
    requestId: "req-001",
    channel: "C_OPS",
    threadTs: "1234.5678",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<Parameters<typeof executeProposal>[2]> = {}) {
  return {
    requestBrandRefreshesBySlugs: vi.fn(),
    enqueueAdminCurationJob: vi.fn(),
    dispatchCurationJob: vi.fn(),
    enqueueCurationRecovery: vi.fn(),
    dispatchWorkflow: vi.fn().mockResolvedValue({ ok: true }),
    findInFlightDispatch: vi.fn().mockResolvedValue(null),
    recordDispatch: vi.fn().mockResolvedValue(undefined),
    clearDispatch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://formoria.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Test 1: refresh_brand_chains_request_enqueue_dispatch
// ---------------------------------------------------------------------------

describe("refresh_brand kind", () => {
  it("chains request → enqueue → dispatch and returns submissionId, jobId, adminUrl", async () => {
    const deps = makeDeps({
      requestBrandRefreshesBySlugs: vi.fn().mockResolvedValue([
        { slug: "test-brand", name: "Test Brand", submissionId: "sub-1", error: null },
      ]),
      enqueueAdminCurationJob: vi.fn().mockResolvedValue({ id: "job-1" }),
      dispatchCurationJob: vi.fn().mockResolvedValue({ accepted: true, status: "accepted" }),
    });

    const result = await executeProposal(
      { kind: "refresh_brand", slug: "test-brand" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({
      ok: true,
      result: {
        submissionId: "sub-1",
        jobId: "job-1",
        adminUrl: "/admin/jobs/job-1",
        summary: "Refresh started for Test Brand — job <https://formoria.com/admin/jobs/job-1|job-1>",
      },
    });

    // Verify call order and arguments
    expect(deps.requestBrandRefreshesBySlugs).toHaveBeenCalledWith(
      ["test-brand"],
      "ops@formoria.com",
    );
    expect(deps.enqueueAdminCurationJob).toHaveBeenCalledWith({
      params: { target: "submissions", submissionIds: ["sub-1"] },
      dryRun: false,
      startedBy: "ops@formoria.com",
    });
    expect(deps.dispatchCurationJob).toHaveBeenCalledWith("job-1");

    // Verify ordering: request before enqueue before dispatch
    const requestOrder = vi.mocked(deps.requestBrandRefreshesBySlugs).mock.invocationCallOrder[0];
    const enqueueOrder = vi.mocked(deps.enqueueAdminCurationJob).mock.invocationCallOrder[0];
    const dispatchOrder = vi.mocked(deps.dispatchCurationJob).mock.invocationCallOrder[0];
    expect(requestOrder).toBeLessThan(enqueueOrder);
    expect(enqueueOrder).toBeLessThan(dispatchOrder);
  });
});

// ---------------------------------------------------------------------------
// Test 2: refresh_brand_surfaces_outcome_error
// ---------------------------------------------------------------------------

describe("refresh_brand with outcome error", () => {
  it("surfaces outcome error without enqueueing", async () => {
    const deps = makeDeps({
      requestBrandRefreshesBySlugs: vi.fn().mockResolvedValue([
        { slug: "broken-brand", name: "Broken", submissionId: null, error: "brand_hidden" },
      ]),
    });

    const result = await executeProposal(
      { kind: "refresh_brand", slug: "broken-brand" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({ ok: false, error: "brand_hidden" });
    expect(deps.enqueueAdminCurationJob).not.toHaveBeenCalled();
    expect(deps.dispatchCurationJob).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 3: rerun_job_rerun_and_resume_modes
// ---------------------------------------------------------------------------

describe("rerun_job kind", () => {
  it("rerun returns the recovery child and target counts", async () => {
    const deps = makeDeps({
      enqueueCurationRecovery: vi.fn().mockResolvedValue({ job: { id: "job-rerun-1" }, counts: { total: 2, failed: 1, cancelled: 1 } }),
      dispatchCurationJob: vi.fn().mockResolvedValue({ accepted: true, status: "accepted" }),
    });

    const result = await executeProposal(
      { kind: "rerun_job", jobId: "job-orig-1", mode: "rerun" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({
      ok: true,
      result: {
        jobId: "job-rerun-1",
        adminUrl: "/admin/jobs/job-rerun-1",
        counts: { total: 2, failed: 1, cancelled: 1 },
        summary: "Re-running job job-orig-1: 2 targets — <https://formoria.com/admin/jobs/job-rerun-1|job-rerun-1>",
      },
    });
    expect(deps.enqueueCurationRecovery).toHaveBeenCalledWith({ sourceJobId: "job-orig-1", startedBy: "ops@formoria.com", action: { kind: "rerun" } });
    expect(deps.dispatchCurationJob).toHaveBeenCalledWith("job-rerun-1");
  });

  it("resume returns one recovery child and target counts", async () => {
    const deps = makeDeps({
      enqueueCurationRecovery: vi.fn().mockResolvedValue({ job: { id: "job-resume-1" }, counts: { total: 3, failed: 2, cancelled: 1 } }),
      dispatchCurationJob: vi.fn().mockResolvedValue({ accepted: true, status: "accepted" }),
    });

    const result = await executeProposal(
      { kind: "rerun_job", jobId: "job-orig-2", mode: "resume" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({
      ok: true,
      result: {
        jobId: "job-resume-1",
        adminUrl: "/admin/jobs/job-resume-1",
        counts: { total: 3, failed: 2, cancelled: 1 },
        summary: "Resuming job job-orig-2: 3 targets — <https://formoria.com/admin/jobs/job-resume-1|job-resume-1>",
      },
    });
    expect(deps.enqueueCurationRecovery).toHaveBeenCalledWith({ sourceJobId: "job-orig-2", startedBy: "ops@formoria.com", action: { kind: "resume" } });
    expect(deps.dispatchCurationJob).toHaveBeenCalledWith("job-resume-1");
  });
});

// ---------------------------------------------------------------------------
// Test 4: dispatch_workflow_only_allowlisted
// ---------------------------------------------------------------------------

describe("dispatch_workflow kind", () => {
  it("dispatches e2e-staging", async () => {
    const deps = makeDeps({
      dispatchWorkflow: vi.fn().mockResolvedValue({ ok: true }),
    });

    const result = await executeProposal(
      { kind: "dispatch_workflow", workflow: "e2e-staging" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({
      ok: true,
      result: {
        dispatched: "e2e-staging",
        summary: "Started e2e run on staging (~20 min). Updates will post in this thread.",
      },
    });
    expect(deps.dispatchWorkflow).toHaveBeenCalled();
  });

  it("refuses when a run is in flight, links its thread, and does not dispatch", async () => {
    const deps = makeDeps({
      findInFlightDispatch: vi.fn().mockResolvedValue({
        id: "req-prev",
        channelId: "C_OPS",
        threadTs: "1111.2222",
        requesterId: "U_OP1",
        runId: null,
        claimedAt: null,
      }),
    });

    const result = await executeProposal(
      { kind: "dispatch_workflow", workflow: "e2e-staging" },
      makeCtx(),
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("in progress");
    expect(result.error).toContain("https://slack.com/archives/C_OPS/p11112222");
    expect(deps.dispatchWorkflow).not.toHaveBeenCalled();
    expect(deps.recordDispatch).not.toHaveBeenCalled();
  });

  it("records the dispatch before triggering Run-now", async () => {
    const order: string[] = [];
    const deps = makeDeps({
      recordDispatch: vi.fn().mockImplementation(async () => {
        order.push("record");
      }),
      dispatchWorkflow: vi.fn().mockImplementation(async () => {
        order.push("dispatch");
        return { ok: true };
      }),
    });

    await executeProposal(
      { kind: "dispatch_workflow", workflow: "e2e-staging" },
      makeCtx(),
      deps,
    );

    expect(deps.recordDispatch).toHaveBeenCalledWith("req-001");
    expect(order).toEqual(["record", "dispatch"]);
    expect(deps.clearDispatch).not.toHaveBeenCalled();
  });

  it("clears the recorded dispatch when Run-now fails", async () => {
    const deps = makeDeps({
      dispatchWorkflow: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "railway 500" }),
    });

    const result = await executeProposal(
      { kind: "dispatch_workflow", workflow: "e2e-staging" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({ ok: false, error: "railway 500" });
    expect(deps.clearDispatch).toHaveBeenCalledWith("req-001");
  });

  it("keeps the Run-now result when clearDispatch rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({
      dispatchWorkflow: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "railway 500" }),
      clearDispatch: vi.fn().mockRejectedValue(new Error("db down")),
    });

    const result = await executeProposal(
      { kind: "dispatch_workflow", workflow: "e2e-staging" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({ ok: false, error: "railway 500" });
    expect(deps.clearDispatch).toHaveBeenCalledWith("req-001");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("keeps the Run-now error when clearDispatch rejects after a throw", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({
      dispatchWorkflow: vi.fn().mockRejectedValue(new Error("railway timeout")),
      clearDispatch: vi.fn().mockRejectedValue(new Error("db down")),
    });

    const result = await executeProposal(
      { kind: "dispatch_workflow", workflow: "e2e-staging" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({ ok: false, error: "railway timeout" });
    expect(deps.clearDispatch).toHaveBeenCalledWith("req-001");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns error when dispatch is refused", async () => {
    const deps = makeDeps({
      dispatchWorkflow: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "failed to invoke cron execution" }),
    });

    const result = await executeProposal(
      { kind: "dispatch_workflow", workflow: "e2e-staging" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({ ok: false, error: "failed to invoke cron execution" });
  });

  it("rejects health-agent (removed)", async () => {
    const deps = makeDeps();

    const result = await executeProposal(
      { kind: "dispatch_workflow", workflow: "health-agent" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({ ok: false, error: "not_allowed" });
    expect(deps.dispatchWorkflow).not.toHaveBeenCalled();
  });

  it("rejects unknown workflow", async () => {
    const deps = makeDeps();

    const result = await executeProposal(
      { kind: "dispatch_workflow", workflow: "evil-workflow" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({ ok: false, error: "not_allowed" });
    expect(deps.dispatchWorkflow).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 6: executor_never_throws
// ---------------------------------------------------------------------------

describe("executor never throws", () => {
  it("catches dep rejection and returns ok:false", async () => {
    const deps = makeDeps({
      requestBrandRefreshesBySlugs: vi.fn().mockRejectedValue(new Error("db exploded")),
    });

    const result = await executeProposal(
      { kind: "refresh_brand", slug: "test-brand" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({ ok: false, error: "db exploded" });
  });

  it("catches non-Error rejection and returns ok:false", async () => {
    const deps = makeDeps({
      requestBrandRefreshesBySlugs: vi.fn().mockRejectedValue("string error"),
    });

    const result = await executeProposal(
      { kind: "refresh_brand", slug: "test-brand" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({ ok: false, error: "string error" });
  });
});
