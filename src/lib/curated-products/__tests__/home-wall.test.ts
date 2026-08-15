import { describe, expect, it } from "vitest";

import type { HomepageCuratedProduct } from "@/lib/services/curated-products";
import type { TrailEntry } from "@/lib/services/trails";
import {
  MAX_HOME_WALL_PRODUCTS,
  buildWallSlots,
} from "../home-wall";

function product(
  key: string,
  overrides: Partial<HomepageCuratedProduct> = {},
): HomepageCuratedProduct {
  return {
    id: `product-${key}`,
    brandId: `brand-${key}`,
    key,
    nameZh: key,
    nameEn: key,
    l1: "home",
    l2: [],
    officialUrl: `https://example.com/${key}`,
    imageUrl: `https://images.example.com/${key}.webp`,
    imageSourceUrl: null,
    imageUsage: "permitted",
    lifecycle: "published",
    linkState: "ok",
    linkCheckedAt: null,
    sourceCheckedAt: "2026-08-15T00:00:00Z",
    reviewDueAt: null,
    notesZh: null,
    notesEn: null,
    highlightPosition: null,
    highlightRationaleZh: null,
    highlightRationaleEn: null,
    wallPosition: null,
    createdAt: "2026-08-15T00:00:00Z",
    trailSlug: null,
    sectionKey: null,
    position: null,
    rationaleZh: "A considered selection",
    rationaleEn: "A considered selection",
    brandSlug: `brand-${key}`,
    brandName: `Brand ${key}`,
    brand: {
      slug: `brand-${key}`,
      purchaseWebsite: null,
      purchasePinkoi: null,
      purchaseShopee: null,
      purchaseMyship: null,
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
    },
    ...overrides,
  };
}

function trail(slug: string, heroImage?: string): TrailEntry {
  return {
    slug,
    frontmatter: {
      title: slug,
      slug,
      heroImage,
    } as TrailEntry["frontmatter"],
  };
}

function productSlots(
  slots: ReturnType<typeof buildWallSlots>["slots"],
) {
  return slots.filter(
    (slot): slot is Extract<(typeof slots)[number], { kind: "product" }> =>
      slot.kind === "product",
  );
}

describe("buildWallSlots", () => {
  it("reserves one trail slot per eight products", () => {
    const result = buildWallSlots({
      products: Array.from({ length: 16 }, (_, index) => product(`p-${index}`)),
      trails: [trail("first", "/first.webp"), trail("second", "/second.webp")],
    });

    expect(
      result.slots.flatMap((slot, index) =>
        slot.kind === "trail" ? [index] : [],
      ),
    ).toEqual([8, 17]);
  });

  it("reserves no trail slot below eight products", () => {
    const onlyTrail = trail("small", "/small.webp");
    const result = buildWallSlots({
      products: Array.from({ length: 7 }, (_, index) => product(`p-${index}`)),
      trails: [onlyTrail],
    });

    expect(result.slots.some((slot) => slot.kind === "trail")).toBe(false);
    expect(result.leftoverTrails).toEqual([onlyTrail]);
  });

  it("never reorders products around a reserved slot", () => {
    const products = Array.from({ length: 16 }, (_, index) => product(`p-${index}`));
    const result = buildWallSlots({
      products,
      trails: [trail("first", "/first.webp"), trail("second", "/second.webp")],
    });

    expect(productSlots(result.slots).map((slot) => slot.product.key)).toEqual(
      products.map((item) => item.key),
    );
  });

  it("caps the wall at MAX_HOME_WALL_PRODUCTS", () => {
    const result = buildWallSlots({
      products: Array.from({ length: 40 }, (_, index) => product(`p-${index}`)),
      trails: [],
    });

    expect(productSlots(result.slots)).toHaveLength(MAX_HOME_WALL_PRODUCTS);
  });

  it("assigns 2x2 and 2x1 spans only to products with wallPosition", () => {
    const result = buildWallSlots({
      products: [
        product("placed-late", { wallPosition: 4 }),
        product("unplaced-first"),
        product("placed-first", { wallPosition: 1 }),
        product("unplaced-last"),
        product("unplaced-five"),
        product("unplaced-six"),
        product("unplaced-seven"),
        product("unplaced-eight"),
      ],
      trails: [],
    });

    const spans = new Map(
      productSlots(result.slots).map((slot) => [slot.product.key, slot.span]),
    );
    expect(spans.get("placed-first")).toBe("2x2");
    expect(spans.get("placed-late")).toBe("2x1");
    expect(spans.get("unplaced-first")).toBe("1x1");
    expect(spans.get("unplaced-last")).toBe("1x1");
  });

  it("caps anchors at a quarter of the wall", () => {
    const result = buildWallSlots({
      products: Array.from({ length: 20 }, (_, index) =>
        product(`p-${index}`, { wallPosition: index }),
      ),
      trails: [],
    });

    expect(
      productSlots(result.slots).filter((slot) => slot.span !== "1x1"),
    ).toHaveLength(5);
  });

  it("keeps no product type above half of the first twelve tiles", () => {
    const products = [
      ...Array.from({ length: 12 }, (_, index) =>
        product(`home-${index}`, { l1: "home" }),
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        product(`beauty-${index}`, { l1: "beauty" }),
      ),
    ];
    const result = buildWallSlots({ products, trails: [] });
    const firstTwelve = productSlots(result.slots).slice(0, 12);

    expect(firstTwelve.filter((slot) => slot.product.l1 === "home")).toHaveLength(
      6,
    );
    expect(productSlots(result.slots)).toHaveLength(products.length);
  });

  it("excludes trails without a heroImage", () => {
    const noHero = trail("no-hero");
    const result = buildWallSlots({
      products: Array.from({ length: 8 }, (_, index) => product(`p-${index}`)),
      trails: [noHero],
    });

    expect(result.slots.some((slot) => slot.kind === "trail")).toBe(false);
    expect(result.leftoverTrails).toEqual([noHero]);
  });
});
