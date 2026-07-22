import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/claim-proof-cleanup", () => ({
  processClaimProofCleanup: vi.fn(),
}));

import { processClaimProofCleanup } from "@/lib/services/claim-proof-cleanup";

describe("POST /api/cron/claim-proof-cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ORIGIN_SECRET", "test-secret");
  });

  it.each([
    ["missing", undefined],
    ["wrong", "wrong-secret"],
  ])("returns 401 for a %s secret", async (_label, secret) => {
    const { POST } = await import("../route");
    const headers = secret ? { "x-origin-verify": secret } : undefined;
    const response = await POST(
      new Request("http://localhost/api/cron/claim-proof-cleanup", {
        method: "POST",
        headers,
      }),
    );

    expect(response.status).toBe(401);
    expect(processClaimProofCleanup).not.toHaveBeenCalled();
  });

  it("runs abandoned cleanup when authorized", async () => {
    vi.mocked(processClaimProofCleanup).mockResolvedValue({
      claimed: 3,
      completed: 2,
      failed: 1,
    });
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/cron/claim-proof-cleanup", {
        method: "POST",
        headers: { "x-origin-verify": "test-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(processClaimProofCleanup).toHaveBeenCalledWith({
      includeAbandoned: true,
    });
    await expect(response.json()).resolves.toEqual({
      claimed: 3,
      completed: 2,
      failed: 1,
    });
  });
});
