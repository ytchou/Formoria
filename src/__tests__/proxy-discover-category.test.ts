import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasUnknownDiscoverCategory, proxy } from "@/proxy";

function request(path: string) {
  return new NextRequest(new URL(`https://formoria.com${path}`), {
    headers: { host: "formoria.com" },
  });
}

describe("hasUnknownDiscoverCategory", () => {
  it("flags deferred and unknown categories", () => {
    for (const category of ["food-drink", "tech", "food", " food "]) {
      expect(
        hasUnknownDiscoverCategory(new URLSearchParams({ category })),
        category,
      ).toBe(true);
    }
  });

  it("passes visible, blank, and missing categories", () => {
    expect(hasUnknownDiscoverCategory(new URLSearchParams("category=home"))).toBe(false);
    expect(hasUnknownDiscoverCategory(new URLSearchParams("category=%20"))).toBe(false);
    expect(hasUnknownDiscoverCategory(new URLSearchParams("sub=beverages"))).toBe(false);
  });
});

// loading.tsx makes /discover stream, so the page's notFound() arrives after a
// 200 status line; the proxy answers these with a real 404.
describe("proxy /discover category guard", () => {
  beforeEach(() => {
    vi.stubEnv("SECURITY_DISABLE_RATE_LIMIT", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers a deferred category with 404 in both locales", async () => {
    for (const path of [
      "/discover?category=food-drink",
      "/en/discover?category=tech",
      "/discover?category=food",
    ]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(404);
    }
  });

  it("leaves a visible category alone", async () => {
    const response = await proxy(request("/discover?category=home"));
    expect(response.status).not.toBe(404);
  });
});
