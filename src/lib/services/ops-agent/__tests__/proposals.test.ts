import { describe, expect, it, vi } from "vitest";

import {
  validateProposal,
  describeProposal,
  type OpsProposal,
} from "../proposals";

// ---------------------------------------------------------------------------
// Test 7: propose_action_validates_union
// ---------------------------------------------------------------------------

describe("validateProposal", () => {
  it("refresh_brand requires slug resolvable", async () => {
    const deps = {
      getBrandBySlug: vi.fn().mockRejectedValue(new Error("not found")),
    };

    const result = await validateProposal(
      { kind: "refresh_brand", slug: "no-such-brand" },
      deps,
    );
    expect(result).toEqual(
      expect.objectContaining({ ok: false, error: "unknown_brand" }),
    );
    expect(deps.getBrandBySlug).toHaveBeenCalledWith("no-such-brand");
  });

  it("refresh_brand succeeds with valid slug", async () => {
    const deps = {
      getBrandBySlug: vi
        .fn()
        .mockResolvedValue({ slug: "good-brand", name: "Good Brand" }),
    };

    const result = await validateProposal(
      { kind: "refresh_brand", slug: "good-brand" },
      deps,
    );
    expect(result).toEqual({ ok: true });
  });

  it("dispatch_workflow accepts only e2e-staging", async () => {
    const result1 = await validateProposal(
      { kind: "dispatch_workflow", workflow: "e2e-staging", mode: "preflight" },
      {},
    );
    expect(result1).toEqual({ ok: true });

    const result2 = await validateProposal(
      { kind: "dispatch_workflow", workflow: "deploy-prod" as never, mode: "preflight" },
      {},
    );
    expect(result2).toEqual(
      expect.objectContaining({ ok: false, error: "invalid_workflow" }),
    );
  });

  it("dispatch_workflow rejects health-agent", async () => {
    const result = await validateProposal(
      { kind: "dispatch_workflow", workflow: "health-agent" as never, mode: "preflight" },
      {},
    );
    expect(result).toEqual(
      expect.objectContaining({ ok: false, error: "invalid_workflow" }),
    );
  });

  it("rerun_job validates mode", async () => {
    const result1 = await validateProposal(
      { kind: "rerun_job", jobId: "job-1", mode: "rerun" },
      {},
    );
    expect(result1).toEqual({ ok: true });

    const result2 = await validateProposal(
      { kind: "rerun_job", jobId: "job-1", mode: "resume" },
      {},
    );
    expect(result2).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Test 8: propose_action_success_calls_on_proposed_and_returns_ok
// ---------------------------------------------------------------------------

describe("describeProposal", () => {
  it("returns action, steps, why, cost for refresh_brand", () => {
    const proposal: OpsProposal = { kind: "refresh_brand", slug: "my-brand" };
    const desc = describeProposal(proposal);
    expect(desc).toHaveProperty("action");
    expect(desc).toHaveProperty("steps");
    expect(desc).toHaveProperty("why");
    expect(desc).toHaveProperty("cost");
    expect(typeof desc.action).toBe("string");
    expect(typeof desc.steps).toBe("string");
    expect(typeof desc.why).toBe("string");
    expect(typeof desc.cost).toBe("string");
  });

  it("returns description for rerun_job", () => {
    const proposal: OpsProposal = {
      kind: "rerun_job",
      jobId: "job-123",
      mode: "rerun",
    };
    const desc = describeProposal(proposal);
    expect(desc.action).toMatch(/rerun/i);
  });

  it("returns description for dispatch_workflow", () => {
    const proposal: OpsProposal = {
      kind: "dispatch_workflow",
      workflow: "e2e-staging",
      mode: "preflight",
    };
    const desc = describeProposal(proposal);
    expect(desc.action).toContain("e2e-staging");
  });

});
