import { describe, expect, it } from "vitest";
import {
  bandOf,
  CUTOFF_WINDOW,
  EDITORIAL_BANDS,
  renderEditorialBands,
} from "../curated-products";

describe("curated-products constants", () => {
  it("bandOf returns the correct band at every edge", () => {
    expect(bandOf(0)).toBe("ineligible");
    expect(bandOf(39)).toBe("ineligible");
    expect(bandOf(40)).toBe("generic");
    expect(bandOf(59)).toBe("generic");
    expect(bandOf(60)).toBe("representative");
    expect(bandOf(74)).toBe("representative");
    expect(bandOf(75)).toBe("strong");
    expect(bandOf(89)).toBe("strong");
    expect(bandOf(90)).toBe("exceptional");
    expect(bandOf(100)).toBe("exceptional");
  });

  it("bandOf returns null for null, NaN, negative, >100, and non-integer", () => {
    expect(bandOf(null)).toBeNull();
    expect(bandOf(NaN)).toBeNull();
    expect(bandOf(-1)).toBeNull();
    expect(bandOf(101)).toBeNull();
    expect(bandOf(50.5)).toBeNull();
  });

  it("renderEditorialBands lists five lines in ascending order with min-max and label", () => {
    const output = renderEditorialBands();
    const lines = output.split("\n").filter(Boolean);

    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("0-39");
    expect(lines[4]).toContain("90-100");

    // ASCII-only: no Han characters.
    expect(output).not.toMatch(/[一-鿿]/u);
  });

  it("EDITORIAL_BANDS keys are the golden approvedBand vocabulary", () => {
    expect(EDITORIAL_BANDS.map((b) => b.key)).toEqual([
      "ineligible",
      "generic",
      "representative",
      "strong",
      "exceptional",
    ]);
  });

  it("CUTOFF_WINDOW equals 15", () => {
    expect(CUTOFF_WINDOW).toBe(15);
  });
});
