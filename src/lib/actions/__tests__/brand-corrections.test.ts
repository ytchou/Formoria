import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  hashVisitorId: vi.fn(),
  signVisitorId: vi.fn(),
  verifyVisitorId: vi.fn(),
  rateLimit: vi.fn(),
  submitCorrection: vi.fn(),
  rateLimitCalls: 0,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: mocks.cookieGet,
    set: mocks.cookieSet,
  })),
  headers: vi.fn(async () => ({
    get: (name: string) =>
      name === "x-forwarded-for" ? "192.0.2.1, 198.51.100.2" : null,
  })),
}));

// Keep the real getClientIpFromHeaders — the header cascade is what this
// action delegates, so mocking it would test nothing.
vi.mock("@/lib/security/rate-limiter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/rate-limiter")>()),
  rateLimit: mocks.rateLimit,
}));

vi.mock("@/lib/security/brand-like-identity", () => ({
  BRAND_LIKE_VISITOR_COOKIE: "fm_like_visitor",
  BRAND_LIKE_VISITOR_COOKIE_OPTIONS: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 31_536_000,
    path: "/",
  },
  hashBrandLikeVisitorId: mocks.hashVisitorId,
  signBrandLikeVisitorId: mocks.signVisitorId,
  verifyBrandLikeVisitorId: mocks.verifyVisitorId,
}));

vi.mock("@/lib/services/brand-corrections", () => ({
  submitCorrection: mocks.submitCorrection,
}));

import { submitCorrectionAction } from "../brand-corrections";

const BRAND_ID = "d9428888-122b-4e1f-b85c-61c0a8904d6a";
const VISITOR_ID = "7b5851e2-57c6-4e36-8d90-0406e5045d62";
const VISITOR_HASH = "a".repeat(64);

const validInput = {
  brandId: BRAND_ID,
  field: "price_range" as const,
  proposedValue: 2,
};

describe("brand-correction actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimitCalls = 0;
    mocks.cookieGet.mockReturnValue(undefined);
    mocks.verifyVisitorId.mockResolvedValue(null);
    mocks.hashVisitorId.mockResolvedValue(VISITOR_HASH);
    mocks.signVisitorId.mockResolvedValue("signed-visitor");
    mocks.rateLimit.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: 0,
    });
    mocks.submitCorrection.mockResolvedValue({
      ok: true,
      id: "correction-1",
    });
  });

  it("rejects a non-uuid brandId", async () => {
    await expect(
      submitCorrectionAction({ ...validInput, brandId: "not-a-uuid" }),
    ).resolves.toEqual({ ok: false, error: "invalid_brand" });
    expect(mocks.submitCorrection).not.toHaveBeenCalled();
  });

  it("returns rate_limited past the window", async () => {
    mocks.rateLimit.mockImplementation(async () => {
      mocks.rateLimitCalls += 1;
      return {
        allowed: mocks.rateLimitCalls <= 5,
        remaining: Math.max(0, 5 - mocks.rateLimitCalls),
        resetAt: 60_000,
      };
    });

    const results = [];
    for (let index = 0; index < 6; index += 1) {
      results.push(await submitCorrectionAction(validInput));
    }

    expect(results[5]).toEqual({ ok: false, error: "rate_limited" });
    expect(mocks.rateLimit).toHaveBeenCalledWith("192.0.2.1", {
      windowMs: 60_000,
      maxRequests: 5,
      prefix: "brand-correction",
    });
  });

  it("mints and sets a signed visitor cookie when absent", async () => {
    const randomUuid = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue(VISITOR_ID);

    await expect(submitCorrectionAction(validInput)).resolves.toEqual({
      ok: true,
      id: "correction-1",
    });

    expect(mocks.signVisitorId).toHaveBeenCalledWith(VISITOR_ID);
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "fm_like_visitor",
      "signed-visitor",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      }),
    );

    randomUuid.mockRestore();
  });

  it("reuses an existing valid visitor cookie without resetting it", async () => {
    mocks.cookieGet.mockReturnValue({ value: "signed-existing" });
    mocks.verifyVisitorId.mockResolvedValue(VISITOR_ID);

    await submitCorrectionAction(validInput);

    expect(mocks.verifyVisitorId).toHaveBeenCalledWith("signed-existing");
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.signVisitorId).not.toHaveBeenCalled();
  });

  it("passes the hashed visitor id to the service, never the raw uuid", async () => {
    mocks.cookieGet.mockReturnValue({ value: "signed-existing" });
    mocks.verifyVisitorId.mockResolvedValue(VISITOR_ID);

    await submitCorrectionAction(validInput);

    expect(mocks.submitCorrection).toHaveBeenCalledWith({
      ...validInput,
      visitorHash: VISITOR_HASH,
    });
    expect(mocks.submitCorrection.mock.calls[0]?.[0]).not.toEqual(
      expect.objectContaining({ visitorHash: VISITOR_ID }),
    );
  });

  it("maps a thrown service error to unavailable", async () => {
    const error = new Error("database unavailable");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.submitCorrection.mockRejectedValue(error);

    await expect(submitCorrectionAction(validInput)).resolves.toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[brand-corrections:submit]",
      error,
    );

    consoleError.mockRestore();
  });
});
