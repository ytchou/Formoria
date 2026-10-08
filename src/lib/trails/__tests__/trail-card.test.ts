import { describe, expect, it } from "vitest";

import type { CuratedProduct } from "@/lib/services/curated-products";
import type { TrailEntry } from "@/lib/services/trails";
import { toTrailCard, toTrailPeekProduct, toTrailPeeks } from "../trail-card";

function trail(overrides: Partial<TrailEntry["frontmatter"]> = {}): TrailEntry {
  return {
    slug: "small-kitchen",
    frontmatter: {
      title: "小廚房的好幫手",
      description: "在小空間裡也能好好做飯。",
      slug: "small-kitchen",
      tags: ["kitchen"],
      locale: "zh-TW",
      publishedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      draft: false,
      series: "home",
      seriesTitle: "居家",
      seriesOrder: 2,
      author: "Formoria 編輯部",
      heroImage: "https://images.example.com/small-kitchen.webp",
      heroImageAlt: "一張木頭砧板",
      sources: ["https://example.com/source"],
      faq: [{ q: "適合誰？", a: "租屋族。" }],
      voiceCanonical: false,
      promise: "給只有一口爐的廚房。",
      readerSituation: "剛搬進套房",
      sections: [
        {
          key: "prep",
          title: "備料",
          notes: { "brand-a/board": "厚實不滑動。" },
        },
      ],
      exclusions: "不收一次性用品。",
      editorialOwner: "editor@example.com",
      reviewedAt: "2026-09-01T00:00:00.000Z",
      reviewDueAt: "2027-03-01T00:00:00.000Z",
      relatedCategories: ["home"],
      relatedStories: ["a-story"],
      relatedTrails: ["another-trail"],
      ...overrides,
    },
  };
}

function product(key: string): CuratedProduct {
  return {
    id: `product-${key}`,
    brandId: `brand-${key}`,
    key,
    nameZh: key,
    nameEn: key,
    category: "home",
    subcategory: "tableware",
    officialUrl: `https://example.com/${key}`,
    imageUrl: `https://images.example.com/${key}.webp`,
    imageSourceUrl: `https://example.com/${key}/source.jpg`,
    visible: true,
    linkState: "ok",
    linkCheckedAt: "2026-09-01T00:00:00Z",
    sourceCheckedAt: "2026-08-15T00:00:00Z",
    reviewDueAt: "2027-01-01T00:00:00Z",
    productDescriptionZh: "手感穩定，適合小空間。",
    productDescriptionEn: "Steady in the hand, made for small kitchens.",
    productPosition: 1,
    createdAt: "2026-08-15T00:00:00Z",
    trailSlug: "small-kitchen",
    sectionKey: "prep",
    position: 0,
    mitQualified: true,
  };
}

describe("toTrailCard", () => {
  it("keeps exactly the fields a trail tile renders", () => {
    expect(toTrailCard(trail())).toStrictEqual({
      slug: "small-kitchen",
      frontmatter: {
        title: "小廚房的好幫手",
        locale: "zh-TW",
        description: "在小空間裡也能好好做飯。",
        promise: "給只有一口爐的廚房。",
        heroImage: "https://images.example.com/small-kitchen.webp",
        heroImageAlt: "一張木頭砧板",
      },
    });
  });

  it("drops sections, notes, faq, sources, and governance fields", () => {
    const serialized = JSON.stringify(toTrailCard(trail()));
    for (const heavy of [
      "sections",
      "notes",
      "faq",
      "sources",
      "editorialOwner",
      "reviewDueAt",
      "relatedStories",
      "厚實不滑動",
    ]) {
      expect(serialized).not.toContain(heavy);
    }
  });

  it("omits optional fields that are undefined instead of emitting the key", () => {
    const card = toTrailCard(
      trail({
        description: undefined,
        promise: undefined,
        heroImage: undefined,
        heroImageAlt: undefined,
      }),
    );
    expect(card).toStrictEqual({
      slug: "small-kitchen",
      frontmatter: { title: "小廚房的好幫手", locale: "zh-TW" },
    });
    expect("description" in card.frontmatter).toBe(false);
    expect("promise" in card.frontmatter).toBe(false);
    expect("heroImage" in card.frontmatter).toBe(false);
    expect("heroImageAlt" in card.frontmatter).toBe(false);
  });
});

describe("toTrailPeekProduct", () => {
  it("keeps only id and imageUrl", () => {
    const peek = toTrailPeekProduct(product("board"));
    expect(peek).toStrictEqual({
      id: "product-board",
      imageUrl: "https://images.example.com/board.webp",
    });
    const serialized = JSON.stringify(peek);
    expect(serialized).not.toContain("productDescriptionZh");
    expect(serialized).not.toContain("linkCheckedAt");
    expect(serialized).not.toContain("imageSourceUrl");
  });

  it("keeps a null imageUrl so the tile renders its empty cell", () => {
    expect(
      toTrailPeekProduct({ ...product("board"), imageUrl: null }),
    ).toStrictEqual({ id: "product-board", imageUrl: null });
  });
});

describe("toTrailPeeks", () => {
  it("projects every entry and keeps every key, including empty ones, in order", () => {
    const peeks = toTrailPeeks({
      "small-kitchen": [product("board"), product("knife")],
      "empty-trail": [],
      "rainy-day": [product("umbrella")],
    });
    expect(Object.keys(peeks)).toStrictEqual([
      "small-kitchen",
      "empty-trail",
      "rainy-day",
    ]);
    expect(peeks).toStrictEqual({
      "small-kitchen": [
        {
          id: "product-board",
          imageUrl: "https://images.example.com/board.webp",
        },
        {
          id: "product-knife",
          imageUrl: "https://images.example.com/knife.webp",
        },
      ],
      "empty-trail": [],
      "rainy-day": [
        {
          id: "product-umbrella",
          imageUrl: "https://images.example.com/umbrella.webp",
        },
      ],
    });
    expect(JSON.stringify(peeks)).not.toContain("productDescriptionZh");
  });

  it("returns an empty record for an empty input", () => {
    expect(toTrailPeeks({})).toStrictEqual({});
  });
});
