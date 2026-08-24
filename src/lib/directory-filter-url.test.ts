import { describe, expect, it } from "vitest";
import {
  clearDirectoryFilters,
  updateDirectoryUrl,
} from "./directory-filter-url";

describe("directory filter URLs", () => {
  it("updates one filter, preserves unrelated state, and resets pagination", () => {
    const params = new URLSearchParams(
      "search=herbs&category=jewelry&price=2&page=3&sort=name",
    );

    expect(updateDirectoryUrl("/brands", params, { search: null })).toBe(
      "/brands?category=jewelry&sort=name",
    );
  });

  it("clearing the category also clears dependent subcategories", () => {
    const params = new URLSearchParams(
      "search=herbs&category=jewelry&sub=earrings&sort=newest",
    );

    expect(updateDirectoryUrl("/brands", params, { category: null })).toBe(
      "/brands?search=herbs&sort=newest",
    );
  });

  it("clears non-search filters while preserving search and sort", () => {
    const params = new URLSearchParams(
      "search=herbs&category=jewelry&sub=earrings&price=2&verification=owned&page=2&sort=name",
    );

    expect(clearDirectoryFilters("/brands", params)).toBe(
      "/brands?search=herbs&sort=name",
    );
  });

  it("can include search when clearing filters", () => {
    const params = new URLSearchParams(
      "search=herbs&category=jewelry&sort=name",
    );

    expect(
      clearDirectoryFilters("/brands", params, { includeSearch: true }),
    ).toBe("/brands?sort=name");
  });

  it("material_round_trips_through_the_url", () => {
    const empty = new URLSearchParams("category=stationery");

    // Set, extend, and clear — the same comma-joined multi-select shape as
    // `?category=`. The value is the ontology slug, never a display label.
    expect(updateDirectoryUrl("/brands", empty, { material: "ceramic" })).toBe(
      "/brands?category=stationery&material=ceramic",
    );
    const applied = new URLSearchParams("category=stationery&material=ceramic");
    expect(
      updateDirectoryUrl("/brands", applied, { material: "ceramic,wood" }),
    ).toBe("/brands?category=stationery&material=ceramic%2Cwood");
    expect(updateDirectoryUrl("/brands", applied, { material: null })).toBe(
      "/brands?category=stationery",
    );
    expect(clearDirectoryFilters("/brands", applied)).toBe("/brands");
  });

  it("material_survives_a_category_change", () => {
    // `sub` is scoped to one L1 and is meaningless under another, so changing
    // the category drops it. `material` is an ORTHOGONAL axis — `ceramic` means
    // the same thing in every category — so dropping it would silently discard
    // a filter the user did not touch.
    const params = new URLSearchParams(
      "category=stationery&sub=washi-tape&material=ceramic&sort=name",
    );

    expect(updateDirectoryUrl("/brands", params, { category: "home" })).toBe(
      "/brands?category=home&material=ceramic&sort=name",
    );
    // Clearing the category entirely still keeps it.
    expect(updateDirectoryUrl("/brands", params, { category: null })).toBe(
      "/brands?material=ceramic&sort=name",
    );
  });

  it("adds search while preserving category and sort and removing page", () => {
    const params = new URLSearchParams(
      "category=stationery&sort=newest&page=4",
    );

    expect(updateDirectoryUrl("/en/brands", params, { search: "台 茶" })).toBe(
      "/en/brands?category=stationery&sort=newest&search=%E5%8F%B0+%E8%8C%B6",
    );
  });
});
