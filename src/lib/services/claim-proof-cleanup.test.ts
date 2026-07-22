import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const remove = vi.fn();
const from = vi.fn(() => ({ remove }));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ rpc, storage: { from } }),
}));

import { processClaimProofCleanup } from "./claim-proof-cleanup";

describe("processClaimProofCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a claimed batch and completes the durable jobs", async () => {
    rpc
      .mockResolvedValueOnce({
        data: [
          { job_id: "job-1", storage_key: "claim-proofs/user/a.png" },
          { job_id: "job-2", storage_key: "claim-proofs/user/b.png" },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    remove.mockResolvedValue({ data: [], error: null });

    await expect(processClaimProofCleanup()).resolves.toEqual({
      claimed: 2,
      completed: 2,
      failed: 0,
    });
    expect(from).toHaveBeenCalledWith("claim-proofs");
    expect(remove).toHaveBeenCalledWith(["user/a.png", "user/b.png"]);
    const leaseToken = rpc.mock.calls[0]?.[1]?.p_lease_token;
    expect(leaseToken).toEqual(expect.any(String));
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "complete_claim_proof_cleanup_jobs",
      {
        p_job_ids: ["job-1", "job-2"],
        p_lease_token: leaseToken,
      },
    );
  });

  it("marks the claimed batch failed when storage deletion fails", async () => {
    rpc
      .mockResolvedValueOnce({
        data: [{ job_id: "job-1", storage_key: "claim-proofs/user/a.png" }],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    remove.mockResolvedValue({
      data: null,
      error: { message: "storage unavailable" },
    });

    await expect(processClaimProofCleanup()).resolves.toEqual({
      claimed: 1,
      completed: 0,
      failed: 1,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "fail_claim_proof_cleanup_jobs", {
      p_job_ids: ["job-1"],
      p_lease_token: expect.any(String),
      p_error: "storage unavailable",
    });
  });

  it("never deletes keys outside the private claim-proofs bucket", async () => {
    rpc
      .mockResolvedValueOnce({
        data: [
          { job_id: "job-1", storage_key: "brand-images/brands/a.png" },
          { job_id: "job-2", storage_key: "claim-proofs/user/b.png" },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    remove.mockResolvedValue({ data: [], error: null });

    await expect(processClaimProofCleanup()).resolves.toEqual({
      claimed: 2,
      completed: 1,
      failed: 1,
    });
    expect(remove).toHaveBeenCalledWith(["user/b.png"]);
    expect(rpc).toHaveBeenNthCalledWith(3, "fail_claim_proof_cleanup_jobs", {
      p_job_ids: ["job-1"],
      p_lease_token: expect.any(String),
      p_error: "invalid claim proof storage key",
    });
  });
});
