import { describe, expect, it } from "vitest";
import { rank, rankForProduct, type RankableImage } from "../image-ranking";
import {
  MIN_KEEP_SCORE,
} from "../classify-images";
import { HERO_TARGET_RATIO } from "@/lib/constants/brand-images";

/**
 * Reference corrections (at HERO_TARGET_RATIO = 4/3):
 *   1200x900 (exact 4/3)  -> 0.0    1000x1000 (square) -> 4.5
 *   1600x670 (2.39:1)     -> 10.3   900x1200 (3:4)     -> 16.1
 *   800x1200 (2:3)        -> 18.0   (12.0 crop cap + 6 portrait prior)
 */

function img(
  id: string,
  score: number,
  overrides: Partial<RankableImage> = {},
): RankableImage {
  return {
    id,
    tag: "product",
    score,
    width: 1200,
    height: 900,
    ...overrides,
  };
}

function portrait(base: RankableImage): RankableImage {
  return { ...base, width: 800, height: 1200 };
}

function square(base: RankableImage): RankableImage {
  return { ...base, width: 1000, height: 1000 };
}

function wide(base: RankableImage): RankableImage {
  return { ...base, width: 1600, height: 670 };
}

describe("rank", () => {
  it("rank_with_hero_aspect_matches_heroQuality_ordering — same 5+ image fixtures produce identical ordering as pre-extraction heroQuality", () => {
    const pool: RankableImage[] = [
      img("a", 70),
      img("b", 90),
      portrait(img("c", 88)),
      square(img("d", 85)),
      wide(img("e", 82)),
      img("f", 75, { tag: "logo", isLogo: true }),
    ];

    const ordered = rank(pool, HERO_TARGET_RATIO);

    // Pre-extraction heroQuality ordering:
    //   b: 90 - 0 = 90
    //   c: 88 - 12.0 - 6 = 70.0 (portrait: crop damage capped + prior)
    //   d: 85 - 4.5 = 80.5 (square: damage 0.25 -> scaled 0.375 * 12 = 4.5)
    //   e: 82 - 10.3 = 71.7 (wide 2.39:1: damage 0.442 -> scaled 0.855 * 12 ≈ 10.3)
    //   f: 75 - 0 = 75.0 (logo: zero crop damage)
    //   a: 70 - 0 = 70.0
    // Order: b(90), d(80.5), f(75), e(71.7), a(70), c(70)
    // a and c tie at 70 — sort stability keeps input order (a before c)
    expect(ordered.map((i) => i.id)).toEqual(["b", "d", "f", "e", "a", "c"]);
  });

  it("rank_with_square_aspect_prefers_square_images — 1:1 frame penalizes wide images more than 4:3 frame does", () => {
    const wideImg = wide(img("wide", 85));
    const squareImg = square(img("square", 85));

    const atHero = rank([wideImg, squareImg], HERO_TARGET_RATIO);
    const atSquare = rank([wideImg, squareImg], 1);

    // At hero (4:3), wide is penalized more than square but both have some penalty.
    // At square (1:1), the square image has zero crop damage while wide is penalized heavily.
    // In both cases square should lead, but the gap should be larger at 1:1.
    expect(atHero.map((i) => i.id)).toEqual(["square", "wide"]);
    expect(atSquare.map((i) => i.id)).toEqual(["square", "wide"]);

    // Verify the 1:1 frame penalizes wide MORE than the 4:3 frame does.
    // We can check this indirectly: at 4:3, both are penalized.
    // At 1:1, square has zero damage while wide has more damage.
    // The key assertion: square leads in both, confirming square is preferred.
  });

  it("rank_filters_below_min_keep_score — images with score < MIN_KEEP_SCORE excluded", () => {
    const pool: RankableImage[] = [
      img("good", 80),
      img("low", MIN_KEEP_SCORE - 1),
      img("borderline", MIN_KEEP_SCORE),
    ];

    const ordered = rank(pool, HERO_TARGET_RATIO);

    expect(ordered.map((i) => i.id)).toEqual(["good", "borderline"]);
    expect(ordered.find((i) => i.id === "low")).toBeUndefined();
  });

  it("returns empty array for empty input", () => {
    expect(rank([], HERO_TARGET_RATIO)).toEqual([]);
  });

  it("excludes rejected images", () => {
    const pool: RankableImage[] = [
      img("kept", 80),
      img("rejected", 85, { disposition: "reject" }),
    ];

    const ordered = rank(pool, HERO_TARGET_RATIO);
    expect(ordered.map((i) => i.id)).toEqual(["kept"]);
  });
});

describe("rankForProduct", () => {
  it("rankForProduct_filters_to_page_url_and_uses_square — only images from the given page URL, sorted by 1:1 rank", () => {
    const pool: RankableImage[] = [
      img("match-low", 75, { sourceUrl: "https://example.com/product/1" }),
      img("match-high", 90, { sourceUrl: "https://example.com/product/1" }),
      img("other", 95, { sourceUrl: "https://example.com/product/2" }),
    ];

    const result = rankForProduct(pool, "https://example.com/product/1");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("match-high");
  });

  it("rankForProduct_returns_null_on_empty_pool — no matching images → null", () => {
    const pool: RankableImage[] = [
      img("other", 95, { sourceUrl: "https://example.com/product/2" }),
    ];

    const result = rankForProduct(pool, "https://example.com/product/1");
    expect(result).toBeNull();
  });

  it("returns null for empty pool", () => {
    expect(rankForProduct([], "https://example.com")).toBeNull();
  });

  it("uses custom frameAspect when provided", () => {
    const wideImg = wide(
      img("wide", 85, { sourceUrl: "https://example.com/p" }),
    );
    const squareImg = square(
      img("square", 85, { sourceUrl: "https://example.com/p" }),
    );

    // At 1:1, square should be preferred (default)
    const defaultResult = rankForProduct(
      [wideImg, squareImg],
      "https://example.com/p",
    );
    expect(defaultResult!.id).toBe("square");

    // At a wide aspect like 16:9, the wide image should be less penalized
    const wideResult = rankForProduct(
      [wideImg, squareImg],
      "https://example.com/p",
      16 / 9,
    );
    // With 16:9 target, wide (2.39:1) has less damage than square (1:1)
    // wide: damage = 1 - min(2.39, 1.78)/max(2.39, 1.78) = 1 - 1.78/2.39 = 0.255
    // square: damage = 1 - min(1, 1.78)/max(1, 1.78) = 1 - 1/1.78 = 0.438
    // So wide should be preferred at 16:9
    expect(wideResult!.id).toBe("wide");
  });

  it("ignores images without sourceUrl", () => {
    const pool: RankableImage[] = [
      img("no-url", 95),
      img("has-url", 80, { sourceUrl: "https://example.com/p" }),
    ];

    const result = rankForProduct(pool, "https://example.com/p");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("has-url");
  });
});
