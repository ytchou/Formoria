import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const INTERNAL_TOKEN = "internal-secret";

function authorizedRequest(): Request {
  return new Request(
    "https://formoria.test/api/internal/personal-os/system-status",
    { headers: { Authorization: `Bearer ${INTERNAL_TOKEN}` } },
  );
}

describe("GET /api/internal/personal-os/system-status", () => {
  beforeEach(() => {
    vi.stubEnv("PERSONAL_OS_INTERNAL_TOKEN", INTERNAL_TOKEN);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
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

  // Bug caught: the endpoint returned a snapshot without the versioned API envelope.
  it("returns schemaVersion 1", async () => {
    const response = await GET(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.schemaVersion).toBe(1);
  });

  it("returns both services and inventory", async () => {
    const response = await GET(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.services).toEqual(expect.any(Array));
    expect(body.services.length).toBeGreaterThan(0);
    expect(body.inventory).toEqual(expect.any(Array));
    expect(body.inventory.length).toBeGreaterThan(body.services.length);
  });

  it("inventory omits env var names", async () => {
    const response = await GET(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.inventory.every(
        (entry: Record<string, unknown>) => !("envVars" in entry),
      ),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain("_API_KEY");
  });

  it("unauthorized returns 401 with no-store", async () => {
    const response = await GET(
      new Request(
        "https://formoria.test/api/internal/personal-os/system-status",
      ),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "unauthorized",
      message: "Unauthorized",
    });
  });
});
