import { describe, expect, it } from "vitest";
import { buildBrandMetaLineParts } from "../brand-meta-line";

const formatFoundingYear = (year: number) => `${year} 年創立`;

describe("buildBrandMetaLineParts", () => {
  it("returns category, city and founded year in reading order", () => {
    expect(
      buildBrandMetaLineParts({
        categoryLabel: "居家生活",
        cityLabel: "嘉義",
        foundingYear: 2018,
        formatFoundingYear,
      }),
    ).toEqual(["居家生活", "嘉義", "2018 年創立"]);
  });

  it("omits a missing category", () => {
    expect(
      buildBrandMetaLineParts({
        categoryLabel: null,
        cityLabel: "嘉義",
        foundingYear: 2018,
        formatFoundingYear,
      }),
    ).toEqual(["嘉義", "2018 年創立"]);
  });

  it("omits a missing city", () => {
    expect(
      buildBrandMetaLineParts({
        categoryLabel: "居家生活",
        cityLabel: undefined,
        foundingYear: 2018,
        formatFoundingYear,
      }),
    ).toEqual(["居家生活", "2018 年創立"]);
  });

  it("omits a missing founding year without calling the formatter", () => {
    let calls = 0;
    expect(
      buildBrandMetaLineParts({
        categoryLabel: "居家生活",
        cityLabel: "嘉義",
        foundingYear: null,
        formatFoundingYear: (year) => {
          calls += 1;
          return String(year);
        },
      }),
    ).toEqual(["居家生活", "嘉義"]);
    expect(calls).toBe(0);
  });

  it("returns no parts when everything is missing", () => {
    expect(
      buildBrandMetaLineParts({
        categoryLabel: null,
        cityLabel: null,
        foundingYear: null,
        formatFoundingYear,
      }),
    ).toEqual([]);
  });

  it("treats blank labels as missing", () => {
    expect(
      buildBrandMetaLineParts({
        categoryLabel: "  ",
        cityLabel: "",
        foundingYear: 2018,
        formatFoundingYear,
      }),
    ).toEqual(["2018 年創立"]);
  });
});
