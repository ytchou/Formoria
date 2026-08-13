import { describe, expect, it } from "vitest";
import nextConfig from "../../../../next.config";

describe("admin redirects", () => {
  it("does not redirect canonical routes back to legacy nested routes", async () => {
    const redirects = await nextConfig.redirects?.();
    const canonicalRoutes = new Set([
      "/admin/submissions",
      "/admin/moderation",
      "/admin/reports",
      "/admin/brands",
    ]);

    expect(
      redirects?.filter(({ source }) => canonicalRoutes.has(source)),
    ).toEqual([]);
  });
});

describe("legacy category redirects", () => {
  it("uses HTTP 301 for every singular category locale variant", async () => {
    const redirects = await nextConfig.redirects?.();
    const legacySources = new Set([
      "/category/:category",
      "/en/category/:category",
      "/zh-TW/category/:category",
    ]);
    const legacyRedirects = redirects?.filter(({ source }) => legacySources.has(source));

    expect(legacyRedirects).toHaveLength(3);
    expect(legacyRedirects?.every((redirect) => redirect.statusCode === 301)).toBe(true);
    expect(legacyRedirects?.every((redirect) => !('permanent' in redirect))).toBe(true);
  });
});

describe("browser permissions", () => {
  it("allows same-origin geolocation while keeping camera and microphone disabled", async () => {
    const headers = await nextConfig.headers?.();
    const permissionsPolicy = headers
      ?.flatMap((entry) => entry.headers)
      .find(({ key }) => key === "Permissions-Policy")?.value;

    expect(permissionsPolicy).toBe(
      "camera=(), microphone=(), geolocation=(self)",
    );
  });
});
