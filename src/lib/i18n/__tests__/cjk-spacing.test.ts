import { describe, expect, it } from "vitest";

import { spaceNameBoundaries } from "@/lib/i18n/cjk-spacing";

describe("spaceNameBoundaries", () => {
  it("spaces a Latin-final name from a following Han character", () => {
    expect(
      spaceNameBoundaries("Golday Jewelry的主要產品有哪些？", "Golday Jewelry"),
    ).toBe("Golday Jewelry 的主要產品有哪些？");
  });

  it("spaces a digit-final name from a following Han character", () => {
    expect(spaceNameBoundaries("Studio 9是怎麼開始的？", "Studio 9")).toBe(
      "Studio 9 是怎麼開始的？",
    );
  });

  it("leaves a Han-final name touching the following Han character", () => {
    expect(
      spaceNameBoundaries(
        "Simply Made 簡單製造的主要產品有哪些？",
        "Simply Made 簡單製造",
      ),
    ).toBe("Simply Made 簡單製造的主要產品有哪些？");
  });

  it("spaces a Latin-initial name from a preceding Han character", () => {
    expect(
      spaceNameBoundaries("可以透過Golday Jewelry官網購買", "Golday Jewelry"),
    ).toBe("可以透過 Golday Jewelry 官網購買");
  });

  it("never adds a space next to punctuation", () => {
    const text =
      "「Golday Jewelry」、Golday Jewelry？Golday Jewelry，Golday Jewelry。";
    expect(spaceNameBoundaries(text, "Golday Jewelry")).toBe(text);
  });

  it("is idempotent", () => {
    const once = spaceNameBoundaries(
      "Golday Jewelry的代表產品包含戒指。Golday Jewelry於 2015 年創立。",
      "Golday Jewelry",
    );
    expect(once).toBe(
      "Golday Jewelry 的代表產品包含戒指。Golday Jewelry 於 2015 年創立。",
    );
    expect(spaceNameBoundaries(once, "Golday Jewelry")).toBe(once);
  });

  it("returns the text unchanged when the name is absent", () => {
    const text = "這個品牌的主要產品有哪些？";
    expect(spaceNameBoundaries(text, "Golday Jewelry")).toBe(text);
  });

  it("returns the text unchanged for an empty name", () => {
    const text = "這個品牌的主要產品有哪些？";
    expect(spaceNameBoundaries(text, "")).toBe(text);
  });
});
