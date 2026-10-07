import { describe, expect, it } from "vitest";
import { displayBrandCount } from "../display-brand-count";

describe("displayBrandCount", () => {
  it.each([
    [0, 0],
    [1, 1],
    [10, 10],
    [11, 10],
    [20, 10],
    [21, 20],
    [291, 290],
    [299, 290],
    [300, 290],
    [301, 300],
  ])("shows %i brands as %i", (total, shown) => {
    expect(displayBrandCount(total)).toBe(shown);
  });
});
