import { describe, expect, it } from "vitest";
import { shouldShowBrandSectionNav } from "../section-nav";

describe("shouldShowBrandSectionNav", () => {
  it.each([
    [0, false],
    [3, false],
    [4, true],
    [6, true],
  ])("with %i sections shows the nav: %s", (count, shown) => {
    expect(shouldShowBrandSectionNav(count)).toBe(shown);
  });
});
