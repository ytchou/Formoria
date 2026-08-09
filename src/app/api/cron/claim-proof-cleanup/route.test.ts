import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Rejection paths only, deliberately.
 *
 * Every case below is answered by `isAuthorizedMachineCaller` BEFORE the route
 * touches `processClaimProofCleanup`, so nothing here reaches Supabase. The
 * 200 path is the opposite: it needs the real cleanup service and a live
 * database, and `scripts/check-test-boundaries.mjs` forbids mocking
 * `@/lib/services/*` to fake it. That success path is covered by the service's
 * own tests, and the authorization logic itself — including the blank-secret
 * hardening asserted here — is covered in
 * `src/lib/security/machine-caller.test.ts`.
 */
import { POST } from "./route";

const url = "https://formoria.com/api/cron/claim-proof-cleanup";
const secret = "mch_2026_08_7f4c3b29a1e6d8f0c2b5a9e4";

describe("POST /api/cron/claim-proof-cleanup", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 when the verification header is absent", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);

    const response = await POST(new Request(url, { method: "POST" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when the verification header is wrong", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);

    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "x-origin-verify": "mch_2026_08_1a6e9c4d8b2f7a0e5c3d1b9f",
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when ORIGIN_SECRET is unset, even for a caller that sends a header", async () => {
    vi.stubEnv("ORIGIN_SECRET", undefined);

    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { "x-origin-verify": secret },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when ORIGIN_SECRET is blank — a blank server secret must not authorize every caller", async () => {
    vi.stubEnv("ORIGIN_SECRET", "");

    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { "x-origin-verify": "" },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
