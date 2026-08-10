import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const INTERNAL_TOKEN = "internal-secret";

function request(token = INTERNAL_TOKEN): Request {
  return new Request("https://formoria.test/api/internal/personal-os/spend", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("GET /api/internal/personal-os/spend", () => {
  beforeEach(() => {
    vi.stubEnv("PERSONAL_OS_INTERNAL_TOKEN", INTERNAL_TOKEN);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 503 when the service throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("database unavailable")),
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "spend_unavailable",
    });
  });

  it("returns the spend snapshot for an authorized caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response("[]", {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-range": "*/0",
            },
          }),
      ),
    );

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.schemaVersion).toBe(1);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 401 without a bearer token", async () => {
    const response = await GET(
      new Request("https://formoria.test/api/internal/personal-os/spend"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "unauthorized",
      message: "Unauthorized",
    });
  });
});
