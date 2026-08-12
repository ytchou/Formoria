import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

function request(path: string, method = "GET") {
  return new NextRequest(new URL(`https://staging.formoria.com${path}`), {
    method,
    headers: { host: "staging.formoria.com" },
  });
}

describe("staging request boundary", () => {
  beforeEach(() => vi.stubEnv("PLAYWRIGHT_TEST", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("marks readable pages private and non-indexable", async () => {
    const response = await proxy(request("/about"));

    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects a Server Action before application code can run", async () => {
    const response = await proxy(request("/submit", "POST"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Staging is read-only",
    });
  });

  it("rejects mutation-via-GET callbacks and hides the sitemap", async () => {
    await expect(
      proxy(request("/api/newsletter/confirm?token=secret")),
    ).resolves.toMatchObject({ status: 403 });
    await expect(proxy(request("/sitemap.xml"))).resolves.toMatchObject({
      status: 404,
    });
  });

  it("keeps the auth callback non-indexable", async () => {
    const response = await proxy(request("/auth/callback?code=existing-user"));

    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});
