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
  // DEV-1551 task 17: the rate-limit gate is its own switch now. PLAYWRIGHT_TEST
  // is kept alongside it for the non-security reads that still consult it.
  beforeEach(() => {
    vi.stubEnv("PLAYWRIGHT_TEST", "true");
    vi.stubEnv("SECURITY_DISABLE_RATE_LIMIT", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("marks readable pages private and non-indexable", async () => {
    const response = await proxy(request("/about"));

    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects an unauthenticated staging Server Action", async () => {
    const response = await proxy(request("/submit", "POST"));

    expect(response.status).toBe(403);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
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

  it("does not lock down mutations on a local dev server pointed at staging", async () => {
    // Pointing .env.local at staging makes isStagingRequest() true on a laptop,
    // which used to 403 every unauthenticated POST on localhost and silently
    // break dev tooling. The lockdown protects the DEPLOYED environment, and
    // `next dev` can never be one.
    vi.stubEnv("NODE_ENV", "development");
    const response = await proxy(request("/submit", "POST"));

    expect(response.status).not.toBe(403);
  });

  it("keeps a deployed container locked down even with NODE_ENV=development", async () => {
    // The exemption above is for a laptop, not for a build mode. A deployed
    // container carries RAILWAY_GIT_COMMIT_SHA, so a stray NODE_ENV must not
    // open every unauthenticated mutation on deployed staging.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(
      "RAILWAY_GIT_COMMIT_SHA",
      "0123456789abcdef0123456789abcdef01234567",
    );
    const response = await proxy(request("/submit", "POST"));

    expect(response.status).toBe(403);
  });

  it("still marks a local dev response non-indexable", async () => {
    // The carve-out above must not leak into finalizeResponse: staging is still
    // staging for robots purposes even when served from a dev server.
    vi.stubEnv("NODE_ENV", "development");
    const response = await proxy(request("/about"));

    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("exposes the deployed Railway revision only on staging", async () => {
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
    const response = await proxy(request("/about"));
    expect(response.headers.get("x-formoria-revision")).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
  });
});
