import { describe, expect, it } from "vitest";
import { parseCommaParam } from "@/lib/seo/directory-filters";

describe("parseCommaParam", () => {
  it("splits a comma-separated string into an array", () => {
    expect(parseCommaParam("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace from entries", () => {
    expect(parseCommaParam("a , b , c")).toEqual(["a", "b", "c"]);
  });

  it("returns empty array for undefined", () => {
    expect(parseCommaParam(undefined)).toEqual([]);
  });

  it("handles an array of comma-separated strings", () => {
    expect(parseCommaParam(["a,b", "c"])).toEqual(["a", "b", "c"]);
  });
});
