import { describe, expect, it } from "vitest";
import {
  buildCaptureQueries,
  mergeCaptureCandidates,
  underfilledCaptureBrands,
} from "./capture";

describe("image-eval capture recovery", () => {
  it("builds deterministic non-promotional fallback queries", () => {
    expect(
      buildCaptureQueries({
        name: "Aireal Land 年零",
        productType: "beauty",
      }),
    ).toEqual([
      '"Aireal Land 年零" beauty 商品 台灣 品牌 -優惠 -折扣 -特價 -coupon',
      '"Aireal Land 年零" beauty 官方網站 商品 -優惠 -折扣 -特價 -coupon',
      '"Aireal Land 年零" beauty 產品 圖片 -優惠 -折扣 -特價 -coupon',
      '"Aireal Land 年零" 台灣 品牌 商品 -優惠 -折扣 -特價 -coupon',
    ]);
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
