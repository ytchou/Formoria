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

  it("adds search while preserving category and sort and removing page", () => {
    const params = new URLSearchParams(
      "category=stationery&sort=newest&page=4",
    );

    expect(updateDirectoryUrl("/en/brands", params, { search: "台 茶" })).toBe(
      "/en/brands?category=stationery&sort=newest&search=%E5%8F%B0+%E8%8C%B6",
    );
  });
});

describe("updateDirectoryUrl — inferred filters", () => {
  it("removes the edited field from inferred", () => {
    const params = new URLSearchParams(
      "q=tea&category=home&material=metal&inferred=category,material",
    );

    expect(updateDirectoryUrl("/discover", params, { material: null })).toBe(
      "/discover?q=tea&category=home&inferred=category",
    );
  });

  it("category change also drops sub from inferred", () => {
    const params = new URLSearchParams(
      "q=tea&category=home&sub=cups&material=metal&inferred=category,sub,material",
    );

    expect(
      updateDirectoryUrl("/discover", params, { category: "beauty" }),
    ).toBe("/discover?q=tea&category=beauty&material=metal&inferred=material");
  });

  it("deletes inferred when it becomes empty", () => {
    const params = new URLSearchParams(
      "q=tea&material=metal&inferred=material",
    );

    expect(updateDirectoryUrl("/discover", params, { material: "wood" })).toBe(
      "/discover?q=tea&material=wood",
    );
  });

  it("always deletes infer", () => {
    const params = new URLSearchParams("q=tea&infer=1&sort=newest");

    expect(updateDirectoryUrl("/discover", params, { material: "wood" })).toBe(
      "/discover?q=tea&sort=newest&material=wood",
    );
  });

  it("leaves URLs without inferred unchanged", () => {
    const params = new URLSearchParams(
      "search=herbs&category=jewelry&price=2&page=3&sort=name",
    );

    expect(updateDirectoryUrl("/brands", params, { search: null })).toBe(
      "/brands?category=jewelry&sort=name",
    );
  });
});
