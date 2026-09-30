import { describe, expect, it } from "vitest";
import { displayBrandCount } from "../display-brand-count";

describe("displayBrandCount", () => {
  it.each([
    [0, 0],
    [30, 30],
    [50, 50],
    [51, 50],
    [100, 50],
    [101, 100],
    [291, 250],
    [300, 250],
    [301, 300],
  ])("shows %i brands as %i", (total, shown) => {
    expect(displayBrandCount(total)).toBe(shown);
  });
});
