import { describe, expect, it } from "vitest";
import { buildImageQueryVariants } from "@/lib/services/enrich-phases/scraper/search";
import {
  PRODUCTION_QUERY_INDEX,
  buildCaptureQueries,
  mergeCaptureCandidates,
  underfilledCaptureBrands,
} from "./capture";

describe("image-eval capture recovery", () => {
  it("puts the production query first and carries no negative terms", () => {
    const queries = buildCaptureQueries({
      name: "Aireal Land 年零",
      productType: "beauty",
    });

    // Byte-identical to what production issues, so a capture run and a
    // production run see the same SERP for the same brand.
    expect(queries[PRODUCTION_QUERY_INDEX]).toBe(
      buildImageQueryVariants({
        brandName: "Aireal Land 年零",
        productType: "beauty",
      })[0],
    );
    expect(queries).toEqual([
      // Production dropped the category from its query; the capture variants
      // below deliberately keep it, since their job is to widen the corpus.
      '"Aireal Land 年零" 商品',
      '"Aireal Land 年零" beauty 官方網站 商品',
      '"Aireal Land 年零" beauty 產品 圖片',
      '"Aireal Land 年零" 台灣 品牌 商品',
    ]);
    // Negatives were measurably harmful and are gone from production; keeping
    // them here would hide the promotional images the classifier must reject.
    expect(queries.some((query) => query.includes("-優惠"))).toBe(false);
  });

  it("adds a website-scoped fallback using the brand's Latin token", () => {
    expect(
      buildCaptureQueries({
        name: "稜光 AURA",
        productType: "crafts",
        purchaseWebsite: "https://www.aura-craft.com/shop",
      }).at(-1),
    ).toBe("site:aura-craft.com AURA");
  });

  it("deduplicates candidates in provider order and caps the per-brand quota", () => {
    const candidate = (imageUrl: string) => ({ imageUrl });

    expect(
      mergeCaptureCandidates(
        [candidate("https://cdn.example/one.webp")],
        [
          candidate("https://cdn.example/one.webp"),
          candidate("https://cdn.example/two.webp"),
        ],
        2,
      ),
    ).toEqual([
      candidate("https://cdn.example/one.webp"),
      candidate("https://cdn.example/two.webp"),
    ]);
  });

  it("reports only brands that fail the exact per-brand quota", () => {
    expect(
      underfilledCaptureBrands(
        [
          { name: "complete", count: 10 },
          { name: "partial", count: 8 },
          { name: "empty", count: 0 },
        ],
        10,
      ),
    ).toEqual(["partial=8", "empty=0"]);
  });
});
