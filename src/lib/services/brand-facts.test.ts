import { describe, expect, it } from "vitest";
import { parseBrandFactsResult } from "./brand-facts";

/**
 * These cases lived in `description-rewrite.test.ts` until the mega-call was
 * split: every field they cover is now produced by the facts call.
 */
function makeTagFixture(
  subcategories: string[],
  subcategories_en: string[],
): string {
  return JSON.stringify({
    price_range: 1,
    subcategories,
    subcategories_en,
    city: null,
    founding_year: null,
  });
}

describe("parseBrandFactsResult", () => {
  it("returns empty facts when the LLM response is not valid JSON", () => {
    const result = parseBrandFactsResult(
      "抱歉，我無法解析，但這裡有超過二十個字元的原始輸出內容",
    );
    expect(result.city).toBeNull();
    expect(result.priceRange).toBeNull();
    expect(result.subcategories).toEqual([]);
  });

  it("maps free-text city names to DB slugs", () => {
    const json = JSON.stringify({
      price_range: 1,
      subcategories: [],
      subcategories_en: [],
      city: "台北",
      founding_year: null,
    });
    expect(parseBrandFactsResult(json).city).toBe("taipei");
  });

  it("returns null city when the value cannot be mapped to a valid slug", () => {
    const json = JSON.stringify({
      price_range: 1,
      subcategories: [],
      subcategories_en: [],
      city: "somewhere unknown",
      founding_year: null,
    });
    expect(parseBrandFactsResult(json).city).toBeNull();
  });

  it("normalizes subcategories against the vocabulary and collapses variants", () => {
    const json = makeTagFixture(
      ["側背包", "口金零錢包", "口金夾"],
      ["crossbody", "clasp coin purse", "clasp wallet"],
    );
    const result = parseBrandFactsResult(json);
    // '側背包' is an alias for crossbody-bags (斜背包); '口金夾' dedupes to same slug as '口金零錢包'
    expect(result.subcategories).toEqual(["斜背包", "口金包"]);
    expect(result.subcategoriesEn).toEqual([
      "Crossbody Bags",
      "Clasp-Frame Bags",
    ]);
  });

  it("keeps a single normalized tag (min-1 gate)", () => {
    const json = makeTagFixture(["口金零錢包", "口金夾"], ["a", "b"]);
    const result = parseBrandFactsResult(json);
    // Both collapse to the same slug → one canonical tag
    // Old min-2 gate would have dropped it; min-1 gate preserves it
    expect(result.subcategories).toEqual(["口金包"]);
    expect(result.subcategoriesEn).toEqual(["Clasp-Frame Bags"]);
  });

  it("drops blocklisted novel tags", () => {
    const json = makeTagFixture(["藍鵲系列襪子"], ["bluebird series socks"]);
    const result = parseBrandFactsResult(json);
    // '系列' matches BLOCKLIST_CONTENT → rejected
    expect(result.subcategories).toEqual([]);
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: "藍鵲系列襪子", reason: "blocklist" }),
      ]),
    );
  });

  it("parses mit_indicators only when evidence backs the claim", () => {
    const withMit = (mit: unknown) =>
      parseBrandFactsResult(
        JSON.stringify({
          subcategories: [],
          subcategories_en: [],
          mit_indicators: mit,
        }),
      ).mitIndicators;

    expect(
      withMit({ mentioned: true, evidence: ["台灣製造"], confidence: "high" }),
    ).toEqual({
      mentioned: true,
      evidence: ["台灣製造"],
      confidence: "high",
    });
    expect(withMit({ mentioned: true, evidence: [] })).toBeNull();
    expect(withMit({ mentioned: false, evidence: ["台灣製造"] })).toBeNull();
    expect(withMit(null)).toBeNull();
  });
});

describe("parseBrandFactsResult — listing verdict", () => {
  const withListing = (listing: unknown): string =>
    JSON.stringify({
      subcategories: [],
      subcategories_en: [],
      city: "台北",
      founding_year: null,
      ...(listing === undefined ? {} : { listing }),
    });

  it("parses a valid listing object", () => {
    const result = parseBrandFactsResult(
      withListing({
        verdict: "reject",
        reason: "沒有自有商品，屬於代購",
        taiwan_connection: "unclear",
        has_own_products: false,
        has_purchase_channel: true,
      }),
    );

    expect(result.listing).toEqual({
      verdict: "reject",
      reason: "沒有自有商品，屬於代購",
      taiwanConnection: "unclear",
      hasOwnProducts: false,
      hasPurchaseChannel: true,
    });
  });

  it("leaves the rest of the extraction valid when listing is absent", () => {
    const result = parseBrandFactsResult(withListing(undefined));

    expect(result.listing).toBeUndefined();
    // The listing verdict is a secondary output — a missing one cannot void the facts.
    expect(result.city).toBe("taipei");
  });

  it("degrades an unknown verdict to undefined without throwing", () => {
    const result = parseBrandFactsResult(
      withListing({
        verdict: "maybe",
        reason: "unsure",
        taiwan_connection: "moon",
      }),
    );

    expect(result.listing).toBeUndefined();
    expect(result.city).toBe("taipei");
  });

  it("degrades a malformed listing value to undefined without throwing", () => {
    expect(
      parseBrandFactsResult(withListing("reject")).listing,
    ).toBeUndefined();
    expect(
      parseBrandFactsResult(withListing(["reject"])).listing,
    ).toBeUndefined();
    expect(parseBrandFactsResult(withListing(null)).listing).toBeUndefined();
  });

  it("keeps a valid verdict while nulling only the unrecognised sub-fields", () => {
    const result = parseBrandFactsResult(
      withListing({
        verdict: "list",
        taiwan_connection: "imported",
        has_own_products: "yes",
      }),
    );

    expect(result.listing).toEqual({
      verdict: "list",
      reason: null,
      taiwanConnection: null,
      hasOwnProducts: null,
      hasPurchaseChannel: null,
    });
  });
});

describe("parseBrandFactsResult — category", () => {
  const withCategory = (categorySlug: unknown): string =>
    JSON.stringify({
      subcategories: [],
      subcategories_en: [],
      city: "台北",
      founding_year: null,
      ...(categorySlug === undefined ? {} : { category: categorySlug }),
    });

  it("parses a valid L1 category slug", () => {
    expect(parseBrandFactsResult(withCategory("beauty")).categorySlug).toBe(
      "beauty",
    );
  });

  it("leaves the extraction valid when category is absent", () => {
    const result = parseBrandFactsResult(withCategory(undefined));

    expect(result.categorySlug).toBeUndefined();
    expect(result.city).toBe("taipei");
  });

  it("degrades an unrecognised category to undefined without voiding the facts", () => {
    for (const value of ["skincare", "美妝", "", 42, null, ["beauty"]]) {
      const result = parseBrandFactsResult(withCategory(value));
      expect(
        result.categorySlug,
        `value: ${JSON.stringify(value)}`,
      ).toBeUndefined();
      expect(result.city).toBe("taipei");
    }
  });
});
