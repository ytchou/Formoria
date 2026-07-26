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

});
