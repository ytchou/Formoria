import { describe, expect, it } from "vitest";

import type { HomepageCuratedProduct } from "@/lib/services/curated-products";
import {
  MAX_HOME_WALL_PRODUCTS,
  buildWallSlots,
  shuffleWithSeed,
  wallSeedForDate,
} from "../home-wall";
import { MAX_HOME_CURATED_PRODUCTS_PER_BRAND } from "../wall-ratio";
import { groupProductsIntoRails } from "../brand-rails";

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
    category: "home",
    subcategory: "tableware",
    mitQualified: false,
    officialUrl: `https://example.com/${key}`,
    imageUrl: `https://images.example.com/${key}.webp`,
    imageSourceUrl: null,
    imageWidth: 1200,
    imageHeight: 900,
    visible: true,
    linkState: "ok",
    linkCheckedAt: null,
    sourceCheckedAt: "2026-08-15T00:00:00Z",
    reviewDueAt: null,
    productDescriptionZh: "手感穩定，適合小空間。",
    productDescriptionEn: "Steady in the hand, made for small kitchens.",
    productPosition: null,
    createdAt: "2026-08-15T00:00:00Z",
    trailSlug: null,
    sectionKey: null,
    position: null,
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

function productSlots(slots: ReturnType<typeof buildWallSlots>) {
  return slots;
}

const SEED = "2026-08-16";
const OTHER_SEED = "2026-08-17";

describe("buildWallSlots", () => {
  it("builds sixteen product slots at full supply", () => {
    const slots = buildWallSlots({
      products: Array.from({ length: 16 }, (_, index) => product(`p-${index}`)),
      seed: SEED,
    });

    expect(slots).toHaveLength(16);
    expect(slots.every((slot) => slot.product)).toBe(true);
  });

  it("caps the wall at MAX_HOME_WALL_PRODUCTS", () => {
    const slots = buildWallSlots({
      products: Array.from({ length: 40 }, (_, index) => product(`p-${index}`)),
      seed: SEED,
    });

    expect(productSlots(slots)).toHaveLength(MAX_HOME_WALL_PRODUCTS);
  });

  it("snaps each product to the nearest of four ratio buckets", () => {
    const slots = buildWallSlots({
      products: [
        product("square", { imageWidth: 1000, imageHeight: 1000 }),
        product("three-four", { imageWidth: 900, imageHeight: 1200 }),
        product("four-three", { imageWidth: 1200, imageHeight: 900 }),
        product("four-five", { imageWidth: 800, imageHeight: 1000 }),
        // A sale banner. Curated-product images have no ingest ratio cap, so
        // the snap is what stops a 4.0 image rendering as a strip.
        product("banner", { imageWidth: 2000, imageHeight: 500 }),
      ],
      seed: SEED,
    });

    const ratios = new Map(
      productSlots(slots).map((slot) => [slot.product.key, slot.ratio]),
    );
    expect(ratios.get("square")).toBe("1:1");
    expect(ratios.get("three-four")).toBe("3:4");
    expect(ratios.get("four-three")).toBe("4:3");
    expect(ratios.get("four-five")).toBe("4:5");
    expect(ratios.get("banner")).toBe("4:3");
  });

  it("falls back to 4:3 when dimensions are null", () => {
    const slots = buildWallSlots({
      products: [
        product("no-width", { imageWidth: null, imageHeight: 900 }),
        product("no-height", { imageWidth: 1200, imageHeight: null }),
      ],
      seed: SEED,
    });

    expect(productSlots(slots).map((slot) => slot.ratio)).toEqual([
      "4:3",
      "4:3",
    ]);
  });

  it("produces the same order twice for the same date seed", () => {
    const products = Array.from({ length: 24 }, (_, index) =>
      product(`p-${index}`),
    );
    const keys = () =>
      productSlots(buildWallSlots({ products, seed: SEED })).map(
        (slot) => slot.product.key,
      );

    expect(keys()).toEqual(keys());
  });

  it("produces a different order for a different date seed", () => {
    const products = Array.from({ length: 24 }, (_, index) =>
      product(`p-${index}`),
    );
    const keysFor = (seed: string) =>
      productSlots(buildWallSlots({ products, seed })).map(
        (slot) => slot.product.key,
      );

    expect(keysFor(SEED)).not.toEqual(keysFor(OTHER_SEED));
  });

  it("no longer emits anchor spans", async () => {
    const slots = buildWallSlots({
      products: Array.from({ length: 20 }, (_, index) => product(`p-${index}`)),
      seed: SEED,
    });

    for (const slot of slots) {
      const values = Object.values(slot as Record<string, unknown>);
      expect(values).not.toContain("2x2");
      expect(values).not.toContain("2x1");
    }

    const wallModule = (await import("../home-wall")) as Record<
      string,
      unknown
    >;
    expect(wallModule.MAX_HOME_WALL_ANCHOR_RATIO).toBeUndefined();
  });

  it("keeps sixteen products from one category", () => {
    // The per-L1 diversity window is GONE (DEV-1496). A run of sixteen home
    // products is a legitimate day's supply, and reordering it around a
    // category budget produced no reader-visible benefit.
    //
    // The fixture mixes a SECOND L1 on purpose, and the oracle is the raw daily
    // shuffle: every product here carries its own brand, so the per-brand cap
    // removes nothing and the wall must be exactly `shuffleWithSeed` sliced to
    // sixteen. Any surviving reordering pass — a per-L1 window above all —
    // moves a key off that sequence and fails the moment it returns.
    const products = [
      ...Array.from({ length: 8 }, (_, index) =>
        product(`home-${index}`, { category: "home" }),
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        product(`beauty-${index}`, { category: "beauty" }),
      ),
    ];

    const slots = productSlots(buildWallSlots({ products, seed: SEED }));

    expect(slots).toHaveLength(16);
    expect(slots.map((slot) => slot.product.key)).toEqual(
      shuffleWithSeed(products, SEED)
        .slice(0, MAX_HOME_WALL_PRODUCTS)
        .map((entry) => entry.key),
    );
  });

  it("caps each brand at MAX_HOME_CURATED_PRODUCTS_PER_BRAND", () => {
    const shared = Array.from({ length: 5 }, (_, index) =>
      product(`shared-${index}`, {
        brandId: "brand-shared",
        category: "beauty",
      }),
    );
    const slots = buildWallSlots({
      products: [
        ...shared,
        ...Array.from({ length: 6 }, (_, index) =>
          product(`free-${index}`, { category: "home" }),
        ),
      ],
      seed: SEED,
    });

    const kept = productSlots(slots).filter(
      (slot) => slot.product.brandId === "brand-shared",
    );
    expect(kept).toHaveLength(MAX_HOME_CURATED_PRODUCTS_PER_BRAND);
    // Whichever two survive, they are drawn from the input rather than invented.
    for (const slot of kept) {
      expect(shared.map((entry) => entry.key)).toContain(slot.product.key);
    }
  });

  it("rotates which two products of a brand appear across dates", () => {
    // The cap runs AFTER the shuffle precisely so this holds: capping in the
    // read would freeze which two of a brand's four the wall can ever show.
    const products = Array.from({ length: 4 }, (_, index) =>
      product(`shared-${index}`, { brandId: "brand-shared" }),
    );
    const visiblePair = (seed: string) =>
      productSlots(buildWallSlots({ products, seed }))
        .map((slot) => slot.product.key)
        .sort();

    expect(visiblePair(SEED)).toHaveLength(2);
    expect(visiblePair(SEED)).not.toEqual(visiblePair(OTHER_SEED));
  });

  it("keeps the daily first product and prefers a different L2 for the brand's second", () => {
    // Catches a plain take-two cap that can spend both brand slots on one L2.
    const products = [
      product("table-1", { brandId: "brand-shared", subcategory: "tableware" }),
      product("table-2", { brandId: "brand-shared", subcategory: "tableware" }),
      product("table-3", { brandId: "brand-shared", subcategory: "tableware" }),
      product("candle", { brandId: "brand-shared", subcategory: "candles" }),
    ];
    const shuffled = shuffleWithSeed(products, SEED);
    const selected = buildWallSlots({ products, seed: SEED }).map(
      (slot) => slot.product,
    );

    expect(selected[0]).toBe(shuffled[0]);
    expect(selected).toHaveLength(2);
    expect(selected[1]!.subcategory).not.toBe(selected[0]!.subcategory);
  });
});

describe("groupProductsIntoRails", () => {
  it("ranks larger L2 groups first and sorts products inside each rail", () => {
    // Catches grouping that inherits an unstable fetch order or ranks rails alphabetically.
    const rails = groupProductsIntoRails([
      product("candle-late", {
        subcategory: "candles",
        productPosition: null,
        createdAt: "2026-08-20T00:00:00Z",
      }),
      product("table-second", {
        subcategory: "tableware",
        productPosition: 2,
      }),
      product("table-first", {
        subcategory: "tableware",
        productPosition: 1,
      }),
      product("candle-early", {
        subcategory: "candles",
        productPosition: null,
        createdAt: "2026-08-10T00:00:00Z",
      }),
      product("table-unplaced", {
        subcategory: "tableware",
        productPosition: null,
      }),
    ]);

    expect(rails.map((rail) => rail.subcategory)).toEqual([
      "tableware",
      "candles",
    ]);
    expect(rails[0]!.products.map((entry) => entry.key)).toEqual([
      "table-first",
      "table-second",
      "table-unplaced",
    ]);
    expect(rails[1]!.products.map((entry) => entry.key)).toEqual([
      "candle-early",
      "candle-late",
    ]);
  });
});

describe("wallSeedForDate", () => {
  it("resolves the calendar day in Asia/Taipei, not UTC", () => {
    // 23:30 UTC is already the next day in Taipei; a UTC seed would rotate the
    // wall eight hours late for every reader in Taiwan.
    expect(wallSeedForDate(new Date("2026-08-16T23:30:00Z"))).toBe(
      "2026-08-17",
    );
    expect(wallSeedForDate(new Date("2026-08-16T15:00:00Z"))).toBe(
      "2026-08-16",
    );
  });
});
