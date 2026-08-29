import { describe, expect, it } from "vitest";
import { DEFERRED_CATEGORY_SLUGS } from "@/lib/taxonomy/ontology";
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

  it("material_makes_a_page_noindex", () => {
    // `DirectoryFacets` carries a `[key: string]: unknown` index signature, so a
    // `material` key type-checks whether or not `hasFacet` counts it. Omitting
    // it from `hasFacet` compiles clean and leaves every `?material=` page
    // INDEXABLE — one filtered permutation per term, all near-duplicates of the
    // unfiltered directory. Nothing else in the type system would catch that,
    // which is why this case exists.
    const result = resolveDirectorySeo(
      state({ categorySlug: "home", facets: { material: ["ceramic"] } }),
    );

    expect(result.robots).toEqual({ index: false, follow: true });
    // Self-canonical, with the facet retained: a noindex page must not point at
    // a different URL.
    expect(result.canonical).toBe(`${base}/brands?category=home&material=ceramic`);
    expect(result.languages?.en).toBe(
      `${base}/en/brands?category=home&material=ceramic`,
    );

    // And on the bare directory, where there is no taxonomy to fall back to.
    const bare = resolveDirectorySeo(
      state({ facets: { material: "ceramic,wood" } }),
    );
    expect(bare.robots).toEqual({ index: false, follow: true });
    expect(bare.canonical).toBe(`${base}/brands?material=ceramic%2Cwood`);

    // The control: no material, no noindex. Without it a bug that flips every
    // page to noindex would pass the assertions above.
    expect(
      resolveDirectorySeo(state({ categorySlug: "home" })).robots,
    ).toBeUndefined();
  });

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
        facets: { material: ["ceramic"], sort: "name" },
      }),
    );

    expect(result.robots).toEqual({ index: false, follow: true });
    expect(result.canonical).toBe(
      `${base}/brands?category=home&material=ceramic&sort=name&page=2`,
    );
    expect(result.languages?.en).toBe(
      `${base}/en/brands?category=home&material=ceramic&sort=name&page=2`,
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

  it("non-launch target is noindex-follow, canonicals to parent, and omits languages", () => {
    const l1 = resolveDirectorySeo(state({ categorySlug: "tech" }));
    const l2 = resolveDirectorySeo(
      state({
        categorySlug: "outdoor",
        subcategorySlug: "outdoor-accessories",
      }),
    );

    expect(l1.robots).toEqual({ index: false, follow: true });
    expect(l1.canonical).toBe(`${base}/brands`);
    expect(l1.languages).toBeUndefined();
    expect(l2.robots).toEqual({ index: false, follow: true });
    expect(l2.canonical).toBe(`${base}/brands?category=outdoor`);
    expect(l2.languages).toBeUndefined();
  });

  it("unrecognized params are stripped, not treated as facets", () => {
    const result = resolveDirectorySeo(state({ facets: { utm_source: "x" } }));

    expect(result.robots).toBeUndefined();
    expect(result.canonical).toBe(`${base}/brands`);
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
