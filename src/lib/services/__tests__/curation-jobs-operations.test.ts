import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: mocks.createServiceClient,
}));

import {
  cancelCurationJob,
  listCurationJobs,
  recordCurationDispatchFailure,
} from "../curation-jobs";

describe("curation job operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServiceClient.mockReturnValue({
      from: mocks.from,
      rpc: mocks.rpc,
    });
  });

  it("records a dispatch failure as a terminal failed job", async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: "job-1" }], error: null });
    const eqStatus = vi.fn(() => ({ select }));
    const eqId = vi.fn(() => ({ eq: eqStatus }));
    const update = vi.fn(() => ({ eq: eqId }));
    mocks.from.mockReturnValue({ update });

    await recordCurationDispatchFailure("job-1", "worker unavailable");

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        dispatch_status: "failed",
        dispatch_error: "worker unavailable",
        job_error: "worker unavailable",
        completed_at: expect.any(String),
        result: { status: "failed", reason: "dispatch_failed" },
      }),
    );
  });

  it("cancels pending or running work through the atomic RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: "job-1", status: "cancelled" }], error: null });

    await expect(cancelCurationJob("job-1", "Cancelled by admin")).resolves.toMatchObject({
      id: "job-1",
      status: "cancelled",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_curation_job", {
      p_job_id: "job-1",
      p_reason: "Cancelled by admin",
    });
  });

  it("orders the unified log by created time and id", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 });
    const orderId = vi.fn(() => ({ limit }));
    const orderCreated = vi.fn(() => ({ order: orderId }));
    const select = vi.fn(() => ({ order: orderCreated }));
    mocks.from.mockReturnValue({ select });

    await listCurationJobs({ limit: 50 });

    expect(orderCreated).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(orderId).toHaveBeenCalledWith("id", { ascending: false });
    expect(limit).toHaveBeenCalledWith(51);
  });
});
