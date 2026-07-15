import { describe, expect, it } from "vitest";
import nextConfig from "../../../../next.config";

describe("admin redirects", () => {
  it("does not redirect canonical routes back to legacy nested routes", async () => {
    const redirects = await nextConfig.redirects?.();
    const canonicalRoutes = new Set([
      "/admin/submissions",
      "/admin/moderation",
      "/admin/reports",
      "/admin/feedback",
      "/admin/brands",
    ]);

    expect(
      redirects?.filter(({ source }) => canonicalRoutes.has(source)),
    ).toEqual([]);
  });
});
