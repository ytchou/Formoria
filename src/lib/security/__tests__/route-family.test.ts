import { describe, expect, it } from "vitest";

import { routing } from "@/i18n/routing";
import {
  ROUTE_FAMILIES,
  classifyRoute,
  isAccountedFamily,
  routeFamily,
  shouldMintVisitorIdentity,
  stripLocalePrefix,
} from "../route-family";

describe("route family", () => {
  it("normalizes locale variants to one family", () => {
    expect(routeFamily("/brands/mizu-tw")).toBe("directory:detail");
    expect(routeFamily("/zh-TW/brands/mizu-tw")).toBe("directory:detail");
    expect(routeFamily("/en/brands/mizu-tw")).toBe("directory:detail");

    // The resource is the same across locales too, or the same 700 slugs would
    // count as 2100 distinct resources.
    const ids = [
      "/brands/mizu-tw",
      "/zh-TW/brands/mizu-tw",
      "/en/brands/mizu-tw",
    ].map((pathname) => classifyRoute(pathname).resourceId);
    expect(new Set(ids).size).toBe(1);
  });

  it("strips only known locale prefixes", () => {
    expect(stripLocalePrefix("/en/brands")).toBe("/brands");
    expect(stripLocalePrefix("/zh-TW")).toBe("/");
    expect(stripLocalePrefix("/enterprise/brands")).toBe("/enterprise/brands");
  });

  it("classifies all eight families", () => {
    expect(routeFamily("/brands")).toBe("directory:list");
    expect(routeFamily("/brands/mizu-tw")).toBe("directory:detail");
    expect(routeFamily("/brands", "search=mizu")).toBe("directory:search");
    expect(routeFamily("/api/search", "q=mizu")).toBe("directory:search");
    expect(routeFamily("/brands/NOT a slug")).toBe("directory:invalid-slug");
    expect(routeFamily("/sitemap.xml")).toBe("directory:sitemap");
    expect(routeFamily("/i/abcdef/cover.webp")).toBe("directory:image");
    expect(routeFamily("/about")).toBe("public:global-content");
    expect(routeFamily("/admin/brands")).toBe("internal:non-public");

    const observed = new Set([
      routeFamily("/brands"),
      routeFamily("/brands/mizu-tw"),
      routeFamily("/brands", "search=mizu"),
      routeFamily("/brands/NOT a slug"),
      routeFamily("/sitemap.xml"),
      routeFamily("/i/abcdef/cover.webp"),
      routeFamily("/about"),
      routeFamily("/admin/brands"),
    ]);
    expect(observed.size).toBe(8);
    expect(ROUTE_FAMILIES).toHaveLength(8);
    for (const family of observed) {
      expect(ROUTE_FAMILIES).toContain(family);
    }
  });

  it("image requests do not consume the detail budget", () => {
    expect(routeFamily("/i/abcdef/cover.webp")).toBe("directory:image");
    expect(routeFamily("/zh-TW/i/abcdef/cover.webp")).toBe("directory:image");
    expect(routeFamily("/i/abcdef/cover.webp")).not.toBe(
      routeFamily("/brands/mizu-tw"),
    );
  });

  it("treats a taxonomy browse path as a list, not a detail", () => {
    expect(routeFamily("/categories")).toBe("directory:list");
    expect(routeFamily("/categories/home-living")).toBe("directory:list");
    expect(routeFamily("/en/categories/home-living/lighting")).toBe(
      "directory:list",
    );
  });

  it("gives each brand slug its own resource id", () => {
    const first = classifyRoute("/brands/alpha-brand");
    const second = classifyRoute("/brands/beta-brand");

    expect(first.resourceId).not.toBe(second.resourceId);
  });
});

/**
 * Regression: `KNOWN_LOCALES` used to be a hand-written literal, the fourth
 * copy of the locale list in the codebase and the only one guarding
 * enumeration. Driven from `routing.locales` so adding a locale there cannot
 * leave this module behind -- a missed locale sends
 * `/<new-locale>/brands/<slug>` into the `public:global-content` catch-all with
 * a fresh, uncounted budget covering the whole directory.
 */
describe("locale prefixes come from the i18n routing config", () => {
  it("strips every configured locale", () => {
    for (const locale of routing.locales) {
      expect(stripLocalePrefix(`/${locale}/brands/mizu-tw`)).toBe(
        "/brands/mizu-tw",
      );
      expect(stripLocalePrefix(`/${locale}`)).toBe("/");
      expect(routeFamily(`/${locale}/brands/mizu-tw`)).toBe("directory:detail");
    }
  });

  it("classifies every configured locale into one resource", () => {
    const ids = routing.locales.map(
      (locale) => classifyRoute(`/${locale}/brands/mizu-tw`).resourceId,
    );
    expect(
      new Set([...ids, classifyRoute("/brands/mizu-tw").resourceId]).size,
    ).toBe(1);
  });
});

/**
 * Regression: every query key used to be folded into the list resourceId, so
 * one client-side navigation to `/brands` produced both `/brands` and
 * `/brands?_rsc=<hash>` -- two distinct resources for one page view, and two
 * different dedup keys.
 */
describe("list resource ids fold only resource-defining params", () => {
  it("ignores the RSC cache-busting param Next appends to every navigation", () => {
    expect(classifyRoute("/brands", "_rsc=1a2b3").resourceId).toBe(
      classifyRoute("/brands").resourceId,
    );
  });

  it("ignores tracking params carried by a shared link", () => {
    const base = classifyRoute("/brands").resourceId;
    expect(classifyRoute("/brands", "utm_source=newsletter").resourceId).toBe(
      base,
    );
    expect(classifyRoute("/brands", "fbclid=abc123").resourceId).toBe(base);
    expect(classifyRoute("/brands", "gclid=abc123").resourceId).toBe(base);
    expect(classifyRoute("/brands", "totally-unknown=1").resourceId).toBe(base);
  });

  it("still separates real filter and pagination views", () => {
    const base = classifyRoute("/brands").resourceId;
    const filtered = classifyRoute(
      "/brands",
      "category=home-living",
    ).resourceId;
    const paged = classifyRoute(
      "/brands",
      "category=home-living&page=2",
    ).resourceId;

    expect(filtered).not.toBe(base);
    expect(paged).not.toBe(filtered);
    for (const key of ["sub", "material", "verification", "sort"]) {
      expect(classifyRoute("/brands", `${key}=x`).resourceId).not.toBe(base);
    }
  });

  it("keeps a filter view stable when tracking params ride along with it", () => {
    expect(
      classifyRoute("/brands", "category=home-living&_rsc=1a2b3").resourceId,
    ).toBe(classifyRoute("/brands", "category=home-living").resourceId);
  });
});

/**
 * Regression: `/admin` and `/dashboard` fell through to
 * `public:global-content` and were scored against the directory thresholds
 * (record 40 / challenge 80 / block 160). An admin working the moderation queue
 * opens 40+ distinct paths in ten minutes, so staff traffic polluted the very
 * distribution the thresholds are to be calibrated from.
 */
describe("non-public surfaces are outside the enumeration ladder", () => {
  const nonPublic = [
    "/admin",
    "/admin/brands",
    "/admin/operations",
    "/api/admin/brands",
    "/api/upload",
    "/dashboard",
    "/zh-TW/dashboard/brands/mizu-tw/edit",
    "/favorites",
    "/settings",
    "/auth/callback",
  ];

  it("does not score them as public directory content", () => {
    for (const path of nonPublic) {
      expect(routeFamily(path)).toBe("internal:non-public");
      expect(routeFamily(path)).not.toBe("public:global-content");
      expect(isAccountedFamily(routeFamily(path))).toBe(false);
    }
  });

  it("leaves every public family accounted", () => {
    for (const path of [
      "/brands",
      "/brands/mizu-tw",
      "/categories",
      "/about",
      "/api/search",
    ]) {
      expect(isAccountedFamily(routeFamily(path))).toBe(true);
    }
  });

  it("keeps the one public API surface in its own family", () => {
    expect(routeFamily("/api/search", "q=mizu")).toBe("directory:search");
  });
});

describe("visitor identity eligibility", () => {
  it("never mints on an image request", () => {
    expect(shouldMintVisitorIdentity("/i/brands/abc/hero.webp")).toBe(false);
    expect(shouldMintVisitorIdentity("/zh-TW/i/brands/abc/hero.webp")).toBe(
      false,
    );
  });

  it("never mints on a non-public surface", () => {
    expect(shouldMintVisitorIdentity("/admin/brands")).toBe(false);
  });

  it("mints on ordinary reader traffic", () => {
    expect(shouldMintVisitorIdentity("/brands")).toBe(true);
    expect(shouldMintVisitorIdentity("/brands/mizu-tw")).toBe(true);
    expect(shouldMintVisitorIdentity("/about")).toBe(true);
  });
});
