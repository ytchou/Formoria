import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);

describe("POST /api/internal/sentry-canary", () => {
  beforeEach(() => {
    sentry.captureException.mockReset();
    vi.stubEnv("ORIGIN_SECRET", "test-canary-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function flushCaptures() {
    for (let turn = 0; turn < 3; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  it("canary returns 401 without the secret and throws a tagged error with it", async () => {
    const { POST } = await import("./route");

    // Without the secret → 401
    const noSecret = new Request("https://formoria.com/api/internal/sentry-canary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "test-token-1" }),
    });
    const unauthorizedResponse = await POST(noSecret);
    expect(unauthorizedResponse.status).toBe(401);

    // With the correct secret → 500 (deliberate canary error)
    const withSecret = new Request("https://formoria.com/api/internal/sentry-canary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-origin-verify": "test-canary-secret",
      },
      body: JSON.stringify({ token: "test-token-2" }),
    });
    const canaryResponse = await POST(withSecret);
    expect(canaryResponse.status).toBe(500);

    await flushCaptures();

    // Verify Sentry received the tagged error
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const [error, options] = sentry.captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("canary");
    expect(options.tags.health_canary).toBe("test-token-2");
  });
});
