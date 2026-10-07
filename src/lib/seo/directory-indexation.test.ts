import { describe, expect, it } from "vitest";
import { routes } from "@/lib/routes";
import { DEFERRED_CATEGORY_SLUGS } from "@/lib/taxonomy/ontology";
import { buildAlternates } from "./alternates";
import { getSiteUrl } from "./site-url";
import {
  isIndexableTarget,
  listIndexableTargets,
  resolveDirectorySeo,
  type DirectoryState,
} from "./directory-indexation";

const base = getSiteUrl();

function state(overrides: Partial<DirectoryState> = {}): DirectoryState {
  return {
    locale: "zh-TW",
    page: 1,
    facets: {},
    ...overrides,
  };
}

describe("resolveDirectorySeo", () => {
  it("bare directory indexes with a self-canonical", () => {
    const result = resolveDirectorySeo(state());

    expect(result.robots).toBeUndefined();
    expect(result.canonical).toBe(`${base}/brands`);
    expect(result.languages?.en).toBe(`${base}/en/brands`);
  });

  it("launch-eligible L1 and L2 index with self-canonicals", () => {
    const l1 = resolveDirectorySeo(state({ categorySlug: "home" }));
    const l2 = resolveDirectorySeo(
      state({ categorySlug: "home", subcategorySlug: "furniture" }),
    );

    expect(l1.robots).toBeUndefined();
    expect(l1.canonical).toBe(`${base}/brands?category=home`);
    expect(l2.robots).toBeUndefined();
    expect(l2.canonical).toBe(`${base}/brands?category=home&sub=furniture`);
  });

  it.each([
    [
      "search",
      { search: "椅子" },
      "/brands?search=%E6%A4%85%E5%AD%90&category=home",
    ],
    [
      "multi-category",
      { multiCategory: "home,fashion" },
      "/brands?category=home%2Cfashion",
    ],
    [
      "multi-sub",
      { multiSub: "furniture,storage" },
      "/brands?category=home&sub=furniture%2Cstorage",
    ],
  ] as const)(
    "each %s facet flips noindex-follow with a self-canonical",
    (_name, facet, expectedPath) => {
      const result = resolveDirectorySeo(
        state({ categorySlug: "home", facets: facet }),
      );

      expect(result.robots).toEqual({ index: false, follow: true });
      expect(result.canonical).toBe(`${base}${expectedPath}`);
    },
  );

  it("treats a sub without a valid category as a noindex self-canonical", () => {
    const result = resolveDirectorySeo(
      state({ subcategorySlug: "furniture", facets: {} }),
    );

    expect(result.robots).toEqual({ index: false, follow: true });
    expect(result.canonical).toBe(`${base}/brands?sub=furniture`);
    expect(result.languages?.en).toBe(`${base}/en/brands?sub=furniture`);
  });

  it("category-route facets preserve the route taxonomy in self-canonicals", () => {
    const l1 = resolveDirectorySeo(
      state({
        surface: "category",
        categorySlug: "home",
        facets: { category: "fashion" },
      }),
    );
    const l2 = resolveDirectorySeo(
      state({
        surface: "category",
        categorySlug: "home",
        subcategorySlug: "furniture",
        facets: { sub: "storage" },
      }),
    );

    expect(l1.robots).toEqual({ index: false, follow: true });
    expect(l1.canonical).toBe(`${base}/brands?category=home`);
    expect(l2.robots).toEqual({ index: false, follow: true });
    expect(l2.canonical).toBe(`${base}/brands?category=home&sub=furniture`);
  });

  it("facet precedence retains explicit sort and page in every self-canonical", () => {
    const result = resolveDirectorySeo(
      state({
        categorySlug: "home",
        page: 2,
        facets: { search: "椅子", sort: "name" },
      }),
    );

    expect(result.robots).toEqual({ index: false, follow: true });
    expect(result.canonical).toBe(
      `${base}/brands?search=%E6%A4%85%E5%AD%90&category=home&sort=name&page=2`,
    );
    expect(result.languages?.en).toBe(
      `${base}/en/brands?search=%E6%A4%85%E5%AD%90&category=home&sort=name&page=2`,
    );
  });

  it("sort canonicalizes to the unsorted state without noindex", () => {
    const result = resolveDirectorySeo(
      state({ categorySlug: "home", facets: { sort: "name" } }),
    );

    expect(result.robots).toBeUndefined();
    expect(result.canonical).toBe(`${base}/brands?category=home`);
  });

  it("page 2 self-canonicalizes retaining page", () => {
    const result = resolveDirectorySeo(
      state({ categorySlug: "home", page: 2 }),
    );

    expect(result.robots).toBeUndefined();
    expect(result.canonical).toBe(`${base}/brands?category=home&page=2`);
  });

  it("deferred category is noindex-follow and canonicals to /brands", () => {
    const l1 = resolveDirectorySeo(state({ categorySlug: "tech" }));
    const l2 = resolveDirectorySeo(
      state({
        categorySlug: "outdoor",
        subcategorySlug: "outdoor-accessories",
      }),
    );

    expect(l1.robots).toEqual({ index: false, follow: true });
    expect(l1.canonical).toBe(`${base}/brands`);
    expect(l2.robots).toEqual({ index: false, follow: true });
    expect(l2.canonical).toBe(`${base}/brands`);
  });

  it("unrecognized params are stripped, not treated as facets", () => {
    const result = resolveDirectorySeo(state({ facets: { utm_source: "x" } }));

    expect(result.robots).toBeUndefined();
    expect(result.canonical).toBe(`${base}/brands`);
  });
});

// `/brands?category=…` (and `&sub=`) IS the category landing surface, so the
// raw query value that resolved into the taxonomy slug is not a facet (SP-03).
describe("resolveDirectorySeo on the /brands category surface", () => {
  function brandsState(
    categorySlug: string | null,
    subcategorySlug: string | undefined,
    facets: DirectoryState["facets"],
    locale: DirectoryState["locale"] = "zh-TW",
  ): DirectoryState {
    return {
      locale,
      surface: "brands",
      categorySlug,
      subcategorySlug,
      page: 1,
      facets: { multiCategory: false, multiSub: false, ...facets },
    };
  }

  it.each(["zh-TW", "en"] as const)(
    "a single resolved L1 query indexes with the sitemap URL as canonical (%s)",
    (locale) => {
      const result = resolveDirectorySeo(
        brandsState("home", undefined, { category: "home" }, locale),
      );
      const expected = buildAlternates(
        routes.brands({ category: "home" }),
        locale,
      );

      expect(result.robots).toBeUndefined();
      expect(result.canonical).toBe(expected.canonical);
      expect(result.languages).toEqual(expected.languages);
    },
  );

  it.each(["zh-TW", "en"] as const)(
    "a single resolved L1 + child L2 query indexes with the sitemap URL as canonical (%s)",
    (locale) => {
      const result = resolveDirectorySeo(
        brandsState(
          "home",
          "furniture",
          { category: "home", sub: "furniture" },
          locale,
        ),
      );
      const expected = buildAlternates(
        routes.brands({ category: "home", sub: "furniture" }),
        locale,
      );

      expect(result.robots).toBeUndefined();
      expect(result.canonical).toBe(expected.canonical);
      expect(result.languages).toEqual(expected.languages);
    },
  );

  it("a resolved category with an explicit sort stays indexable", () => {
    const result = resolveDirectorySeo(
      brandsState("home", undefined, { category: "home", sort: "name" }),
    );

    expect(result.robots).toBeUndefined();
    expect(result.canonical).toBe(`${base}/brands?category=home`);
  });

  it("multi-value category stays noindex", () => {
    const result = resolveDirectorySeo(
      brandsState(null, undefined, {
        category: "home,fashion",
        multiCategory: true,
      }),
    );

    expect(result.robots).toEqual({ index: false, follow: true });
  });

  it("multi-value sub under a resolved category stays noindex", () => {
    const result = resolveDirectorySeo(
      brandsState("home", undefined, {
        category: "home",
        sub: "furniture,storage",
        multiSub: true,
      }),
    );

    expect(result.robots).toEqual({ index: false, follow: true });
  });

  it("repeated category params stay noindex even if one value resolved", () => {
    const result = resolveDirectorySeo(
      brandsState("home", undefined, { category: ["home", "home"] }),
    );

    expect(result.robots).toEqual({ index: false, follow: true });
  });

  it("an invalid category value stays noindex", () => {
    const result = resolveDirectorySeo(
      brandsState(null, undefined, { category: "not-a-category" }),
    );

    expect(result.robots).toEqual({ index: false, follow: true });
  });

  it("a sub the page dropped (no category) stays noindex", () => {
    const result = resolveDirectorySeo(
      brandsState(null, undefined, { sub: "pants" }),
    );

    expect(result.robots).toEqual({ index: false, follow: true });
    expect(result.canonical).toBe(`${base}/brands?sub=pants`);
  });

  it("an unknown sub under a resolved category stays noindex", () => {
    const result = resolveDirectorySeo(
      brandsState("home", undefined, {
        category: "home",
        sub: "not-a-subcategory",
      }),
    );

    expect(result.robots).toEqual({ index: false, follow: true });
  });

  it("a cross-L1 sub stays noindex", () => {
    const result = resolveDirectorySeo(
      brandsState("fashion", "furniture", {
        category: "fashion",
        sub: "furniture",
      }),
    );

    expect(result.robots).toEqual({ index: false, follow: true });
  });

  it("search on a resolved category stays noindex", () => {
    const result = resolveDirectorySeo(
      brandsState("home", undefined, { category: "home", search: "椅子" }),
    );

    expect(result.robots).toEqual({ index: false, follow: true });
  });

  it("a category-route query naming the route's own L1 is still a facet", () => {
    const result = resolveDirectorySeo(
      state({
        surface: "category",
        categorySlug: "home",
        facets: { category: "home" },
      }),
    );

    expect(result.robots).toEqual({ index: false, follow: true });
  });
});

describe("directory indexable targets", () => {
  it("listIndexableTargets returns only launch-eligible L1/L2 rows", () => {
    const targets = listIndexableTargets();

    expect(targets.length).toBeGreaterThan(0);
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ categorySlug: "home" }),
        expect.objectContaining({
          categorySlug: "home",
          subcategorySlug: "furniture",
        }),
      ]),
    );
    expect(
      targets.some((target) =>
        DEFERRED_CATEGORY_SLUGS.has(target.categorySlug),
      ),
    ).toBe(false);
    expect(isIndexableTarget("food-drink")).toBe(false);
    expect(
      targets.some(
        (target) => target.subcategorySlug === "outdoor-accessories",
      ),
    ).toBe(false);
    for (const target of targets) {
      expect(
        isIndexableTarget(target.categorySlug, target.subcategorySlug),
      ).toBe(true);
    }
  });
});
