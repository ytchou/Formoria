import { describe, expect, it } from "vitest";

import {
  buildDirectoryUrlState,
  directoryCategoryChipSlugs,
  directoryTaxonomyHref,
  shouldEmitDirectoryItemList,
  type DirectoryUrlStateInput,
} from "@/lib/brands/directory-presentation";
import {
  L1_CATEGORIES,
  resolveDirectorySubcategorySlugs,
} from "@/lib/taxonomy/ontology";

/**
 * The directory decisions `DirectoryView` used to take inline, now taken here.
 * They are pure functions of the parsed filters, so they are asserted directly:
 * a component test would have to replace the four brand queries around them,
 * which `scripts/check-test-boundaries.mjs` forbids and CLAUDE.md rules out.
 */

/** Resolved through the ontology, so a fixture cannot outlive its taxonomy. */
function categoryFixture(slug: string): { slug: string } {
  const found = L1_CATEGORIES.find((item) => item.slug === slug);
  if (!found) throw new Error(`unknown L1 fixture: ${slug}`);
  return { slug: found.slug };
}

function subcategoryFixture(slug: string): { slug: string; category: string } {
  const found = resolveDirectorySubcategorySlugs([slug]).at(0);
  if (!found) throw new Error(`unknown L2 fixture: ${slug}`);
  return { slug: found.slug, category: found.category };
}

/** The same defaults `DirectoryView` passes for an unfiltered zh-TW request. */
function urlState(overrides: Partial<DirectoryUrlStateInput> = {}) {
  return buildDirectoryUrlState({
    locale: "zh-TW",
    categorySlugs: [],
    subcategorySlugs: [],
    search: "",
    materials: [],
    verificationFilter: "all",
    sort: "random",
    ...overrides,
  });
}

const BAGS = categoryFixture("bags-accessories");
const BACKPACKS = subcategoryFixture("backpacks");

describe("directoryCategoryChipSlugs", () => {
  it("advertises no category chip while an L2 is filtering", () => {
    // The brand query drops the L1 whenever an L2 is active, so a category chip
    // would claim a filter the results do not obey: this page legitimately
    // lists a `fashion` brand tagged `backpacks`.
    expect(directoryCategoryChipSlugs([BAGS.slug], [BACKPACKS.slug])).toEqual(
      [],
    );
  });

  it("drops the chip for a cross-L1 pair too", () => {
    expect(directoryCategoryChipSlugs(["fashion"], [BACKPACKS.slug])).toEqual(
      [],
    );
  });

  it("keeps the chip once the L2 is gone", () => {
    expect(directoryCategoryChipSlugs([BAGS.slug], [])).toEqual([BAGS.slug]);
  });
});

describe("directoryTaxonomyHref", () => {
  it("removes the L2 chip to its parent category rather than to the current URL", () => {
    const state = urlState({
      category: BAGS,
      subcategory: BACKPACKS,
      categorySlugs: [BAGS.slug],
      subcategorySlugs: [BACKPACKS.slug],
    });

    // The taxonomy lives in the PATH here, so deleting a query key resolved to
    // `/categories/bags-accessories/backpacks` itself — a dead control.
    expect(state.routePath).toBe("/categories/bags-accessories/backpacks");
    expect(directoryTaxonomyHref(state, [BAGS.slug], [])).toBe(
      "/categories/bags-accessories",
    );
  });

  it("material_chip_survives_removing_a_taxonomy_chip", () => {
    const state = urlState({
      category: BAGS,
      subcategory: BACKPACKS,
      categorySlugs: [BAGS.slug],
      subcategorySlugs: [BACKPACKS.slug],
      materials: ["ceramic"],
    });

    expect(state.normalizedParams.get("material")).toBe("ceramic");
    expect(directoryTaxonomyHref(state, [BAGS.slug], [])).toBe(
      "/brands?material=ceramic&category=bags-accessories",
    );
  });

  it("removes the category chip to the unfiltered directory on an L1 route", () => {
    const home = categoryFixture("home");
    const state = urlState({ category: home, categorySlugs: [home.slug] });

    expect(directoryTaxonomyHref(state, [], [])).toBe("/brands");
  });
});

describe("buildDirectoryUrlState", () => {
  it("keeps an unaddressable cross-L1 pair on /brands, in the query", () => {
    const state = urlState({
      category: categoryFixture("fashion"),
      subcategory: BACKPACKS,
      categorySlugs: ["fashion"],
      subcategorySlugs: [BACKPACKS.slug],
    });

    expect(state.routePath).toBe("/brands");
    expect(state.normalizedParams.get("category")).toBe("fashion");
    expect(state.normalizedParams.get("sub")).toBe("backpacks");
    // The taxonomy keys are what a taxonomy href replaces; the facets are not.
    expect(state.facetParams.get("category")).toBeNull();
    expect(state.facetParams.get("sub")).toBeNull();
  });

  it("carries every orthogonal facet, and omits the defaults", () => {
    const state = urlState({
      search: "tote",
      materials: ["ceramic"],
      verificationFilter: "mit-verified",
      sort: "newest",
    });

    expect(state.normalizedParams.get("search")).toBe("tote");
    expect(state.normalizedParams.get("material")).toBe("ceramic");
    expect(state.normalizedParams.get("verification")).toBe("mit-verified");
    expect(state.normalizedParams.get("sort")).toBe("newest");
    expect(urlState().normalizedParams.toString()).toBe("");
  });
});

describe("shouldEmitDirectoryItemList", () => {
  const unfiltered = {
    indexable: true,
    categorySlugs: [] as string[],
    search: "",
    materials: [] as string[],
    verificationFilter: "all" as const,
    page: 1,
  };

  it("emits the ItemList on the unfiltered first page", () => {
    expect(shouldEmitDirectoryItemList(unfiltered)).toBe(true);
  });

  it("suppresses the directory ItemList once a material narrows the page", () => {
    // Every other facet already suppressed it. A `?material=` page is
    // `index:false` with a self-canonical, so an ItemList naming the whole
    // directory would describe a page Google is told not to index.
    expect(
      shouldEmitDirectoryItemList({ ...unfiltered, materials: ["ceramic"] }),
    ).toBe(false);
  });

  it("never emits it on a page the SEO matrix marked noindex", () => {
    // The invalid-term case, which is where the two decisions used to diverge.
    // On `?material=xyz` the closed vocabulary drops the unknown term, so every
    // PARSED field below is the unfiltered directory — while
    // `resolveDirectorySeo` reads the RAW query and returns `noindex, follow`.
    // The ItemList of all approved brands shipped anyway, describing a page
    // crawlers were told to skip (DEV-1524).
    expect(
      shouldEmitDirectoryItemList({ ...unfiltered, indexable: false }),
    ).toBe(false);
  });

  it("suppresses it for every other narrowing axis", () => {
    const narrowed = [
      { ...unfiltered, categorySlugs: ["home"] },
      { ...unfiltered, search: "tote" },
      { ...unfiltered, verificationFilter: "mit-verified" as const },
      { ...unfiltered, page: 2 },
    ];

    expect(narrowed.map(shouldEmitDirectoryItemList)).toEqual(
      narrowed.map(() => false),
    );
  });
});
