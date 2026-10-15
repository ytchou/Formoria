import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "@/lib/services/curated-products-catalog";
import type { SearchResult } from "@/lib/services/product-situation-search";
import type { TrailEntry } from "@/lib/services/trails";
import {
  buildActiveFilters,
  buildInferredFields,
  buildMaterialOptions,
  buildSearchTelemetry,
  buildSubcategoryOptions,
  decideDiscoverSurfaces,
  isIntentParseRequested,
  isPageOutOfRange,
  mergeEffectiveFilters,
  parseDiscoverPage,
  shouldParseIntent,
  sliceArmBySlot,
  toEmptyRouteTrail,
} from "../discover-view";

const NO_INFERENCE = { category: null, subcategory: null, materials: [] };
const CJK_QUERY = "送給媽媽的生日禮物";

describe("isIntentParseRequested", () => {
  it("is true for infer=1 with a CJK-rich query", () => {
    expect(isIntentParseRequested({ infer: "1" }, CJK_QUERY)).toBe(true);
  });

  it("reads the first value of a repeated infer param", () => {
    expect(isIntentParseRequested({ infer: ["1", "0"] }, CJK_QUERY)).toBe(true);
  });

  it("is false without the trigger or with another trigger value", () => {
    expect(isIntentParseRequested({}, CJK_QUERY)).toBe(false);
    expect(isIntentParseRequested({ infer: "true" }, CJK_QUERY)).toBe(false);
  });

  it("is false with no query or a query too short to parse", () => {
    expect(isIntentParseRequested({ infer: "1" }, null)).toBe(false);
    expect(isIntentParseRequested({ infer: "1" }, "mug")).toBe(false);
  });
});

describe("shouldParseIntent", () => {
  it("enables the paid parse only for an authenticated viewer", () => {
    expect(shouldParseIntent({ infer: "1" }, CJK_QUERY, true)).toBe(true);
    expect(shouldParseIntent({ infer: "1" }, CJK_QUERY, false)).toBe(false);
  });

  it("stays off for an authenticated viewer when no parse was requested", () => {
    expect(shouldParseIntent({}, CJK_QUERY, true)).toBe(false);
  });
});

describe("parseDiscoverPage", () => {
  it("defaults to 1 when absent, empty, invalid or below 1", () => {
    expect(parseDiscoverPage(undefined)).toBe(1);
    expect(parseDiscoverPage("  ")).toBe(1);
    expect(parseDiscoverPage("abc")).toBe(1);
    expect(parseDiscoverPage("0")).toBe(1);
    expect(parseDiscoverPage("-3")).toBe(1);
  });

  it("reads the first value and parses a leading integer", () => {
    expect(parseDiscoverPage(["3", "9"])).toBe(3);
    expect(parseDiscoverPage("2abc")).toBe(2);
  });
});

describe("mergeEffectiveFilters", () => {
  it("keeps URL values over inferred ones", () => {
    expect(
      mergeEffectiveFilters(
        { category: "home", subcategories: ["bedding"], materials: ["wood"] },
        { category: "fashion", subcategory: "dresses", materials: ["glass"] },
      ),
    ).toEqual({ category: "home", subcategories: ["bedding"], materials: ["wood"] });
  });

  it("fills empty URL fields from the inference", () => {
    expect(
      mergeEffectiveFilters(
        { category: null, subcategories: [], materials: [] },
        { category: "fashion", subcategory: "dresses", materials: ["glass"] },
      ),
    ).toEqual({ category: "fashion", subcategories: ["dresses"], materials: ["glass"] });
  });

  it("is empty when neither side has a value", () => {
    expect(
      mergeEffectiveFilters(
        { category: null, subcategories: [], materials: [] },
        NO_INFERENCE,
      ),
    ).toEqual({ category: null, subcategories: [], materials: [] });
  });
});

describe("buildInferredFields", () => {
  it("keeps URL-marked fields first, then appends what this request inferred", () => {
    expect(
      buildInferredFields("material", {
        category: "home",
        subcategory: "bedding",
        materials: ["wood"],
      }),
    ).toEqual(["material", "category", "sub", "material"]);
  });

  it("drops unknown URL fields and adds nothing without inference", () => {
    expect(buildInferredFields("bogus,sub", NO_INFERENCE)).toEqual(["sub"]);
    expect(buildInferredFields(undefined, NO_INFERENCE)).toEqual([]);
  });
});

describe("buildSubcategoryOptions", () => {
  const counts = [
    { slug: "dresses", count: 4 },
    { slug: "bedding", count: 2 },
    { slug: "tea", count: 7 },
    { slug: "not-a-real-sub", count: 1 },
  ];

  it("keeps only the active category's subcategories", () => {
    expect(buildSubcategoryOptions(counts, "home", "zh-TW")).toEqual([
      { slug: "bedding", label: "寢具", count: 2, category: "home" },
    ]);
  });

  it("keeps every visible category's subcategories with no category, dropping deferred ones", () => {
    expect(buildSubcategoryOptions(counts, null, "en")).toEqual([
      { slug: "dresses", label: "Dresses", count: 4, category: "fashion" },
      { slug: "bedding", label: "Bedding", count: 2, category: "home" },
    ]);
  });
});

describe("buildMaterialOptions", () => {
  const counts = [
    { slug: "wood", count: 3 },
    { slug: "glass", count: 0 },
    { slug: "unknown-material", count: 2 },
  ];

  it("drops zero counts and labels by locale, falling back to the slug", () => {
    expect(buildMaterialOptions(counts, "home", "zh-TW")).toEqual([
      { value: "wood", label: "木", count: 3 },
      { value: "unknown-material", label: "unknown-material", count: 2 },
    ]);
    expect(buildMaterialOptions(counts, null, "en")).toEqual([
      { value: "wood", label: "Wood", count: 3 },
      { value: "unknown-material", label: "unknown-material", count: 2 },
    ]);
  });

  it("offers none for a category where material does not apply", () => {
    expect(buildMaterialOptions(counts, "beauty", "zh-TW")).toEqual([]);
  });
});

describe("buildActiveFilters", () => {
  const effective = {
    category: "home",
    subcategories: ["bedding", "not-a-real-sub"],
    materials: ["wood", "unknown-material"],
  };

  it("adds a category chip only in search mode, with inferred badges", () => {
    expect(
      buildActiveFilters({
        isSearchMode: true,
        effective,
        inferredFields: ["category", "material"],
        locale: "zh-TW",
      }),
    ).toEqual([
      { type: "category", slug: "home", label: "居家生活", inferred: true },
      { type: "subcategory", slug: "bedding", label: "寢具", inferred: false },
      { type: "subcategory", slug: "not-a-real-sub", label: "not-a-real-sub", inferred: false },
      { type: "material", slug: "wood", label: "木", inferred: true },
      { type: "material", slug: "unknown-material", label: "unknown-material", inferred: true },
    ]);
  });

  it("omits the category chip in browse mode and uses English labels on /en", () => {
    expect(
      buildActiveFilters({
        isSearchMode: false,
        effective: { category: "home", subcategories: ["bedding"], materials: ["wood"] },
        inferredFields: [],
        locale: "en",
      }),
    ).toEqual([
      { type: "subcategory", slug: "bedding", label: "Bedding", inferred: false },
      { type: "material", slug: "wood", label: "Wood", inferred: false },
    ]);
  });

  it("omits the category chip for a deferred category", () => {
    expect(
      buildActiveFilters({
        isSearchMode: true,
        effective: { category: "food-drink", subcategories: [], materials: [] },
        inferredFields: [],
        locale: "en",
      }),
    ).toEqual([]);
  });
});

describe("isPageOutOfRange", () => {
  it("404s only pages past the last one, never page 1", () => {
    expect(isPageOutOfRange(1, 0, 20)).toBe(false);
    expect(isPageOutOfRange(2, 0, 20)).toBe(true);
    expect(isPageOutOfRange(2, 21, 20)).toBe(false);
    expect(isPageOutOfRange(3, 40, 20)).toBe(true);
  });
});

describe("sliceArmBySlot", () => {
  it("returns the current page's arms, or undefined without interleaving", () => {
    const arms = Array.from({ length: 25 }, (_, i) => (i % 2 ? "ltr" : "rrf") as "ltr" | "rrf");
    expect(sliceArmBySlot(arms, 2, 20)).toEqual(arms.slice(20, 40));
    expect(sliceArmBySlot(undefined, 1, 20)).toBeUndefined();
  });
});

describe("decideDiscoverSurfaces", () => {
  const base = {
    isSearchMode: false,
    url: { category: null, subcategories: [], materials: [] },
    page: 1,
    productCount: 5,
    activeFilterCount: 0,
  };

  it("shows the trail rail only on the unfiltered first browse page with products", () => {
    expect(decideDiscoverSurfaces(base)).toEqual({
      showSearchEmpty: false,
      showFilters: true,
      showTrailRail: true,
      hasChips: false,
    });
    expect(decideDiscoverSurfaces({ ...base, page: 2 }).showTrailRail).toBe(false);
    expect(decideDiscoverSurfaces({ ...base, productCount: 0 }).showTrailRail).toBe(false);
    expect(
      decideDiscoverSurfaces({ ...base, url: { ...base.url, materials: ["wood"] } })
        .showTrailRail,
    ).toBe(false);
  });

  it("hides filters for a zero-result search with no filter applied", () => {
    expect(
      decideDiscoverSurfaces({ ...base, isSearchMode: true, productCount: 0 }),
    ).toEqual({
      showSearchEmpty: true,
      showFilters: false,
      showTrailRail: false,
      hasChips: true,
    });
  });

  it("keeps filters for a zero-result search that has a filter", () => {
    expect(
      decideDiscoverSurfaces({
        ...base,
        isSearchMode: true,
        productCount: 0,
        activeFilterCount: 1,
      }).showFilters,
    ).toBe(true);
  });
});

describe("toEmptyRouteTrail", () => {
  const trail = {
    slug: "gift",
    frontmatter: { title: "送禮", locale: "zh-TW" },
  } as TrailEntry;

  it("marks a zh title with lang on /en only", () => {
    expect(toEmptyRouteTrail(trail, "en")).toEqual({
      slug: "gift",
      title: "送禮",
      lang: "zh-Hant-TW",
    });
    expect(toEmptyRouteTrail(trail, "zh-TW")).toEqual({ slug: "gift", title: "送禮" });
  });
});

describe("buildSearchTelemetry", () => {
  const products = [{ key: "a" }, { key: "b" }] as CatalogProduct[];

  it("uses neutral defaults when no search result exists", () => {
    expect(
      buildSearchTelemetry({
        query: "x",
        search: null,
        products: [],
        totalCount: 0,
        searchSource: "discover_page",
      }),
    ).toEqual({
      query: "x",
      resultCount: 0,
      searchId: undefined,
      productKeys: [],
      searchSource: "discover_page",
      degraded: false,
      intentParsed: "skipped",
      intentCategory: null,
      intentSubcategory: null,
      intentMaterials: [],
      intentCacheHit: false,
      intentLatencyMs: 0,
      rpcLatencyMs: 0,
      embedLatencyMs: 0,
      ltrMode: undefined,
      ltrLatencyMs: undefined,
      featuresLatencyMs: undefined,
      ltrScores: undefined,
      ltrRanks: undefined,
      ltrProductKeys: undefined,
      rrfProductKeys: undefined,
      armBySlot: undefined,
    });
  });

  it("copies the search result's fields and the page's product keys", () => {
    const search = {
      searchId: "s1",
      degraded: true,
      intentParsed: "ok",
      intentCategory: "home",
      intentSubcategory: "bedding",
      intentMaterials: ["wood"],
      intentCacheHit: true,
      intentLatencyMs: 12,
      rpcLatencyMs: 30,
      embedLatencyMs: 8,
      ltrMode: "interleave",
      ltrLatencyMs: 4,
      featuresLatencyMs: 2,
      ltrScores: [0.5],
      ltrRanks: [0],
      ltrProductKeys: ["b"],
      rrfProductKeys: ["a"],
      armBySlot: ["rrf", "ltr"],
    } as SearchResult;
    expect(
      buildSearchTelemetry({
        query: CJK_QUERY,
        search,
        products,
        totalCount: 42,
        searchSource: "hero",
      }),
    ).toEqual({
      query: CJK_QUERY,
      resultCount: 42,
      searchId: "s1",
      productKeys: ["a", "b"],
      searchSource: "hero",
      degraded: true,
      intentParsed: "ok",
      intentCategory: "home",
      intentSubcategory: "bedding",
      intentMaterials: ["wood"],
      intentCacheHit: true,
      intentLatencyMs: 12,
      rpcLatencyMs: 30,
      embedLatencyMs: 8,
      ltrMode: "interleave",
      ltrLatencyMs: 4,
      featuresLatencyMs: 2,
      ltrScores: [0.5],
      ltrRanks: [0],
      ltrProductKeys: ["b"],
      rrfProductKeys: ["a"],
      armBySlot: ["rrf", "ltr"],
    });
  });
});
