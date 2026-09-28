import { describe, expect, it } from "vitest";

import {
  parseDiscoverQuery,
  parseDiscoverSource,
  discoverMetadataFor,
  hrefWithoutQuery,
  parseInferredFields,
  buildDiscoverSyncQuery,
  discoverClearAllKeys,
  firstValue,
  hasInferParam,
  sortOptionsFor,
  QUALIFYING_MATERIAL_SLUGS,
} from "../discover-search-params";

describe("parseDiscoverQuery", () => {
  it("reads q, trims, and defaults sort to relevance only when q is present", () => {
    // Empty q → no query mode
    const noQ = parseDiscoverQuery({});
    expect(noQ.query).toBeNull();
    expect(noQ.sort).toBe("newest");

    // Whitespace-only q → no query mode
    const wsQ = parseDiscoverQuery({ q: "   " });
    expect(wsQ.query).toBeNull();
    expect(wsQ.sort).toBe("newest");

    // Valid q with category and explicit sort
    const withSort = parseDiscoverQuery({
      q: "  送禮  ",
      category: "home",
      sort: "newest",
    });
    expect(withSort.query).toBe("送禮");
    expect(withSort.sort).toBe("newest");

    // Valid q without explicit sort → defaults to relevance
    const defaultSort = parseDiscoverQuery({ q: "搬新家" });
    expect(defaultSort.query).toBe("搬新家");
    expect(defaultSort.sort).toBe("relevance");
  });
});

describe("discoverMetadataFor", () => {
  it("sets robots.index=false only when q is present and canonical never carries q", () => {
    const withQ = discoverMetadataFor({ query: "送禮", category: null });
    expect(withQ.robots).toEqual({ index: false, follow: true });
    expect(withQ.canonicalPath).not.toContain("q=");

    const withQAndCategory = discoverMetadataFor({
      query: "送禮",
      category: "home",
    });
    expect(withQAndCategory.robots).toEqual({ index: false, follow: true });
    expect(withQAndCategory.canonicalPath).toContain("category=home");
    expect(withQAndCategory.canonicalPath).not.toContain("q=");

    const noQ = discoverMetadataFor({ query: null, category: null });
    expect(noQ.robots).toBeNull();
    expect(noQ.canonicalPath).toBe("/discover");

    const noQWithCategory = discoverMetadataFor({
      query: null,
      category: "home",
    });
    expect(noQWithCategory.robots).toBeNull();
    expect(noQWithCategory.canonicalPath).toBe("/discover?category=home");
  });

  it("includes a single qualifying material in the canonical", () => {
    const result = discoverMetadataFor({
      query: null,
      category: null,
      materials: ["ceramic"],
    });
    expect(result.canonicalPath).toContain("material=ceramic");
    expect(result.robots).toBeNull();
  });

  it("includes material alongside category in the canonical", () => {
    const result = discoverMetadataFor({
      query: null,
      category: "home",
      materials: ["wood"],
    });
    expect(result.canonicalPath).toContain("category=home");
    expect(result.canonicalPath).toContain("material=wood");
    expect(result.robots).toBeNull();
  });

  it("sets noindex for a below-threshold material", () => {
    const result = discoverMetadataFor({
      query: null,
      category: null,
      materials: ["bamboo"],
    });
    expect(result.robots).toEqual({ index: false, follow: true });
    expect(result.canonicalPath).not.toContain("material=");
  });

  it("sets noindex for multiple materials (combinatorial)", () => {
    const result = discoverMetadataFor({
      query: null,
      category: null,
      materials: ["ceramic", "wood"],
    });
    expect(result.robots).toEqual({ index: false, follow: true });
    expect(result.canonicalPath).not.toContain("material=");
  });

  it("QUALIFYING_MATERIAL_SLUGS contains the expected 9 slugs", () => {
    expect(QUALIFYING_MATERIAL_SLUGS.size).toBe(9);
    for (const slug of ["ceramic", "wood", "textile", "glass", "metal", "wool", "leather", "paper", "stone"]) {
      expect(QUALIFYING_MATERIAL_SLUGS.has(slug)).toBe(true);
    }
    expect(QUALIFYING_MATERIAL_SLUGS.has("bamboo")).toBe(false);
    expect(QUALIFYING_MATERIAL_SLUGS.has("rattan")).toBe(false);
    expect(QUALIFYING_MATERIAL_SLUGS.has("lacquer")).toBe(false);
  });
});

describe("hrefWithoutQuery", () => {
  it("drops q and keeps category/sub/material/sort", () => {
    const href = hrefWithoutQuery(
      "/discover",
      new URLSearchParams(
        "q=test&category=home&sub=candles&material=wood&sort=newest",
      ),
    );
    expect(href).not.toContain("q=");
    expect(href).toContain("category=home");
    expect(href).toContain("sub=candles");
    expect(href).toContain("material=wood");
    expect(href).toContain("sort=newest");

    // Only q → bare path
    const bare = hrefWithoutQuery(
      "/discover",
      new URLSearchParams("q=test"),
    );
    expect(bare).toBe("/discover");
  });

  it("drops q plus every field listed in inferred and inferred itself, keeps manual filters", () => {
    const href = hrefWithoutQuery(
      "/discover",
      new URLSearchParams(
        "q=tea&category=home&sub=cups&material=metal&inferred=sub,material&sort=newest",
      ),
    );
    expect(href).toBe("/discover?category=home&sort=newest");
  });

  it("removing an inferred category also removes the sub scoped to it", () => {
    const href = hrefWithoutQuery(
      "/discover",
      new URLSearchParams("q=tea&category=home&sub=cups&inferred=category"),
    );
    expect(href).toBe("/discover");
  });

  it("drops infer", () => {
    const href = hrefWithoutQuery(
      "/discover",
      new URLSearchParams("q=tea&infer=1&material=wood"),
    );
    expect(href).toBe("/discover?material=wood");
  });
});

describe("parseInferredFields", () => {
  it("returns only known fields (category|sub|material)", () => {
    expect(
      parseInferredFields("material,bogus,category,,sub,material"),
    ).toEqual(["category", "sub", "material"]);
    expect(parseInferredFields(["sub", "price"])).toEqual(["sub"]);
    expect(parseInferredFields("")).toEqual([]);
    expect(parseInferredFields(undefined)).toEqual([]);
  });
});

describe("firstValue", () => {
  it("reads the first entry of an array-valued param", () => {
    expect(firstValue(["a", "b"])).toBe("a");
    expect(firstValue("a")).toBe("a");
    expect(firstValue(undefined)).toBeUndefined();
    expect(firstValue([])).toBeUndefined();
  });
});

describe("hasInferParam", () => {
  it("is true whenever infer is present, whatever its value", () => {
    expect(hasInferParam({ infer: "1" })).toBe(true);
    expect(hasInferParam({ infer: ["1", "1"] })).toBe(true);
    expect(hasInferParam({ infer: "" })).toBe(true);
    expect(hasInferParam({ q: "tea" })).toBe(false);
  });
});

describe("discoverClearAllKeys", () => {
  it("search mode clears category, inferred and q as well", () => {
    expect(discoverClearAllKeys(new URLSearchParams("q=tea"))).toEqual([
      "category",
      "inferred",
      "q",
    ]);
  });

  it("a whitespace-only q is browse mode, so category stays", () => {
    expect(
      discoverClearAllKeys(new URLSearchParams("q=%20&category=home")),
    ).toEqual([]);
  });
});

describe("buildDiscoverSyncQuery", () => {
  it("writes effective category/sub/material, inferred list, keeps q and sort, drops infer and page", () => {
    const query = buildDiscoverSyncQuery(
      { q: "送禮 茶", infer: "1", page: "3", sort: "newest", material: "wood" },
      {
        category: "home",
        subcategories: ["tea-and-coffee-ware"],
        materials: ["wood"],
      },
      ["category", "sub"],
    );
    const params = new URLSearchParams(query);
    expect(query.startsWith("?")).toBe(true);
    expect(params.get("q")).toBe("送禮 茶");
    expect(params.get("category")).toBe("home");
    expect(params.get("sub")).toBe("tea-and-coffee-ware");
    expect(params.get("material")).toBe("wood");
    expect(params.get("inferred")).toBe("category,sub");
    expect(params.get("sort")).toBe("newest");
    expect(params.has("infer")).toBe(false);
    expect(params.has("page")).toBe(false);
  });

  it("keeps page when the URL carries no infer trigger (pagination within a search)", () => {
    expect(
      buildDiscoverSyncQuery(
        { q: "tea", page: "2", inferred: "material", material: "metal" },
        { category: null, subcategories: [], materials: ["metal"] },
        ["material"],
      ),
    ).toBe("?q=tea&material=metal&inferred=material&page=2");
  });

  it("an array-valued infer is still a fresh submit: page and infer are dropped", () => {
    expect(
      buildDiscoverSyncQuery(
        { q: "tea", infer: ["1", "1"], page: "3" },
        { category: null, subcategories: [], materials: [] },
        [],
      ),
    ).toBe("?q=tea");
  });

  it("omits inferred when no field was inferred", () => {
    const query = buildDiscoverSyncQuery(
      { q: "tea", category: "home" },
      { category: "home", subcategories: [], materials: [] },
      [],
    );
    expect(query).toBe("?q=tea&category=home");
    expect(
      buildDiscoverSyncQuery(
        {},
        { category: null, subcategories: [], materials: [] },
        [],
      ),
    ).toBe("");
  });

  it("returns the same string for a URL that already matches", () => {
    const effective = {
      category: "home",
      subcategories: ["cups", "pots"],
      materials: ["metal"],
    };
    const first = buildDiscoverSyncQuery(
      { q: "送禮 茶", infer: "1", sort: "relevance" },
      effective,
      ["category", "sub", "material"],
    );

    const current = new URLSearchParams(first);
    const rawParams: Record<string, string> = {};
    current.forEach((value, key) => {
      rawParams[key] = value;
    });
    const second = buildDiscoverSyncQuery(rawParams, effective, [
      "category",
      "sub",
      "material",
    ]);

    expect(second).toBe(first);
    expect(`?${current.toString()}`).toBe(first);
  });
});

describe("sortOptionsFor", () => {
  it("lists relevance first only when hasQuery", () => {
    const withQuery = sortOptionsFor(true);
    expect(withQuery[0]).toBe("relevance");
    expect(withQuery).toContain("newest");
    expect(withQuery).toContain("alphabetical");

    const noQuery = sortOptionsFor(false);
    expect(noQuery).not.toContain("relevance");
    expect(noQuery[0]).toBe("newest");
    expect(noQuery).toContain("alphabetical");
  });
});

// Prevent submitted attribution leaking into shared URLs or accepting arbitrary sources.
it("reads nav/hero attribution and removes one-time src/infer parameters", () => {
  expect(parseDiscoverSource({ src: "nav" })).toBe("nav");
  expect(parseDiscoverSource({ src: "hero" })).toBe("hero");
  expect(parseDiscoverSource({ src: "email" })).toBe("discover_page");
  expect(parseDiscoverSource({})).toBe("discover_page");
  expect(buildDiscoverSyncQuery({ q: "春池", src: "hero", infer: "1" }, { category: null, subcategories: [], materials: [] }, [])).toBe("?q=%E6%98%A5%E6%B1%A0");
});
