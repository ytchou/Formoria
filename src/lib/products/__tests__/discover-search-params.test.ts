import { describe, expect, it } from "vitest";

import {
  parseDiscoverQuery,
  discoverMetadataFor,
  hrefWithoutQuery,
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
