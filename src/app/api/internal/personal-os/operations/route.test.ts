import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const INTERNAL_TOKEN = "internal-secret";

function request(authorized = true): Request {
  return new Request(
    "https://formoria.test/api/internal/personal-os/operations",
    {
      headers: authorized
        ? { Authorization: `Bearer ${INTERNAL_TOKEN}` }
        : undefined,
    },
  );
}

describe("GET /api/internal/personal-os/operations", () => {
  beforeEach(() => {
    vi.stubEnv("PERSONAL_OS_INTERNAL_TOKEN", INTERNAL_TOKEN);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://formoria.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // Bug caught: an internal route could be cached or queried before authenticating the caller.
  it("authenticates before serving the no-store operational snapshot", async () => {
    const response = await GET(request(false));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "unauthorized",
      message: "Unauthorized",
    });
  });

  it("returns the versioned generic contract for an authorized caller", async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        status: expect.any(String),
        services: expect.any(Array),
      }),
    );
    expect(body.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cloudflare",
          health: expect.objectContaining({ checks: expect.any(Array) }),
        }),
      ]),
    );
  });
});
