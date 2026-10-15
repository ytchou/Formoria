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

describe("legacy admin page stubs", () => {
  it.each([
    ["/admin/catalog", "/admin/brands"],
    ["/admin/catalog/brands", "/admin/brands"],
    ["/admin/review-queue", "/admin/submissions"],
    ["/admin/review-queue/submissions", "/admin/submissions"],
    ["/admin/review-queue/moderation", "/admin/moderation"],
    ["/admin/signals", "/admin/reports"],
    ["/admin/signals/reports", "/admin/reports"],
  ])("hops %s to %s with a temporary redirect", async (source, destination) => {
    const redirects = await nextConfig.redirects?.();
    const rule = redirects?.find((redirect) => redirect.source === source);

    // DEV-2029 replaced the page-level redirect stubs with config rules. They
    // stay temporary (307) so a bookmarked hop is never cached forever.
    expect(rule?.destination).toBe(destination);
    expect(rule?.permanent).toBe(false);
  });
});

describe("removed admin claim routes", () => {
  it("hops /admin/claim-requests to /admin with a temporary redirect", async () => {
    const redirects = await nextConfig.redirects?.();
    const claimRedirect = redirects?.find(
      ({ source }) => source === "/admin/claim-requests",
    );

    // DEV-1570 deleted /admin/claims. The previous rule was a 308, which admin
    // browsers cache indefinitely, so the hop has to survive and land on a real
    // page -- and stay temporary so this rule is itself invalidatable.
    expect(claimRedirect?.destination).toBe("/admin");
    expect(claimRedirect?.permanent).toBe(false);
  });
});

describe("legacy category redirects", () => {
  it("leaves singular category variants to taxonomy-aware proxy handling", async () => {
    const redirects = await nextConfig.redirects?.();
    const legacySources = new Set([
      "/category/:category",
      "/en/category/:category",
      "/zh-TW/category/:category",
    ]);
    const legacyRedirects = redirects?.filter(({ source }) =>
      legacySources.has(source),
    );

    expect(legacyRedirects).toEqual([]);
  });

  it("does not redirect localized category indexes to the brand directory", async () => {
    const redirects = await nextConfig.redirects?.();
    const categoryIndexes = new Set([
      "/categories",
      "/en/categories",
      "/zh-TW/categories",
    ]);

    expect(
      redirects?.filter(({ source }) => categoryIndexes.has(source)),
    ).toEqual([]);
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
