import { describe, expect, it } from "vitest";
import { CITY_SLUGS } from "../taiwan-cities";
import { TAIWAN_DISTRICTS } from "../taiwan-districts";

const districts = Object.values(TAIWAN_DISTRICTS).flat();

describe("TAIWAN_DISTRICTS", () => {
  it("exports a non-empty district list", () => {
    expect(districts.length).toBeGreaterThan(0);
  });

  it("every district slug is unique across the whole table", () => {
    const slugs = districts.map((district) => district.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every city key is a valid CitySlug", () => {
    expect(Object.keys(TAIWAN_DISTRICTS).sort()).toEqual(
      [...CITY_SLUGS].sort(),
    );
  });

  it("every district has a non-empty zh name and slug", () => {
    expect(districts.every(({ zh, slug }) => zh && slug)).toBe(true);
  });
});
