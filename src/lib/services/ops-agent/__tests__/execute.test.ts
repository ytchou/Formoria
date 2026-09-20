import { describe, expect, it, vi, beforeEach } from "vitest";

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
    dispatchWorkflow: vi.fn(),
    runCodeFix: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
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
      result: { jobId: "job-rerun-1", adminUrl: "/admin/jobs/job-rerun-1", counts: { total: 2, failed: 1, cancelled: 1 } },
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
      result: { jobId: "job-resume-1", adminUrl: "/admin/jobs/job-resume-1", counts: { total: 3, failed: 2, cancelled: 1 } },
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

    expect(result).toEqual({ ok: true, result: { dispatched: "e2e-staging" } });
    expect(deps.dispatchWorkflow).toHaveBeenCalledWith("e2e-staging.yml", {});
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
// Test 5: code_fix_dispatches_ops_fix_with_context
// ---------------------------------------------------------------------------

describe("code_fix kind", () => {
  it("publishes the Railway code fix and returns its draft PR", async () => {
    const deps = makeDeps({
      runCodeFix: vi.fn().mockResolvedValue({
        ok: true,
        prUrl: "https://github.com/ytchou/Formoria/pull/1200",
        prNumber: 1200,
      }),
    });
    const ctx = makeCtx({
      requestId: "req-fix-1",
      channel: "C_FIX",
      threadTs: "9999.0001",
    });

    const result = await executeProposal(
      { kind: "code_fix", instruction: "Fix the broken import in brands.ts" },
      ctx,
      deps,
    );

    expect(result).toEqual({
      ok: true,
      result: {
        prUrl: "https://github.com/ytchou/Formoria/pull/1200",
        prNumber: 1200,
      },
    });
    expect(deps.runCodeFix).toHaveBeenCalledWith({
      instruction: "Fix the broken import in brands.ts",
      requestId: "req-fix-1",
    });
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
      runCodeFix: vi.fn().mockRejectedValue("string error"),
    });

    const result = await executeProposal(
      { kind: "code_fix", instruction: "fix something" },
      makeCtx(),
      deps,
    );

    expect(result).toEqual({ ok: false, error: "string error" });
  });
});
