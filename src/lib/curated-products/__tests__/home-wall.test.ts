import { describe, expect, it } from "vitest";

import type { HomepageCuratedProduct } from "@/lib/services/curated-products";
import type { TrailEntry } from "@/lib/services/trails";
import {
  MAX_HOME_WALL_PRODUCTS,
  buildWallSlots,
  shuffleWithSeed,
  wallSeedForDate,
} from "../home-wall";
import { MAX_HOME_CURATED_PRODUCTS_PER_BRAND } from "../wall-ratio";

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
    subcategories: [],
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

function productSlots(slots: ReturnType<typeof buildWallSlots>) {
  return slots.filter(
    (slot): slot is Extract<(typeof slots)[number], { kind: "product" }> =>
      slot.kind === "product",
  );
}

const SEED = "2026-08-16";
const OTHER_SEED = "2026-08-17";

describe("buildWallSlots", () => {
  it("reserves one trail slot per eight products", () => {
    const slots = buildWallSlots({
      products: Array.from({ length: 16 }, (_, index) => product(`p-${index}`)),
      trails: [trail("first", "/first.webp"), trail("second", "/second.webp")],
      seed: SEED,
    });

    expect(
      slots.flatMap((slot, index) =>
        slot.kind === "trail" ? [index] : [],
      ),
    ).toEqual([8, 17]);
  });

  it("reserves no trail slot below eight products", () => {
    const slots = buildWallSlots({
      products: Array.from({ length: 7 }, (_, index) => product(`p-${index}`)),
      trails: [trail("small", "/small.webp")],
      seed: SEED,
    });

    expect(slots.some((slot) => slot.kind === "trail")).toBe(false);
  });

  it("caps the wall at MAX_HOME_WALL_PRODUCTS", () => {
    const slots = buildWallSlots({
      products: Array.from({ length: 40 }, (_, index) => product(`p-${index}`)),
      trails: [],
      seed: SEED,
    });

    expect(productSlots(slots)).toHaveLength(MAX_HOME_WALL_PRODUCTS);
  });

  it("excludes trails without a heroImage", () => {
    const slots = buildWallSlots({
      products: Array.from({ length: 8 }, (_, index) => product(`p-${index}`)),
      trails: [trail("no-hero")],
      seed: SEED,
    });

    expect(slots.some((slot) => slot.kind === "trail")).toBe(false);
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
      trails: [],
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
      trails: [],
      seed: SEED,
    });

    expect(productSlots(slots).map((slot) => slot.ratio)).toEqual([
      "4:3",
      "4:3",
    ]);
  });

  it("assigns trails their own two formats", () => {
    const slots = buildWallSlots({
      products: Array.from({ length: 24 }, (_, index) => product(`p-${index}`)),
      trails: [trail("first", "/first.webp"), trail("second", "/second.webp")],
      seed: SEED,
    });

    const formats = slots.flatMap((slot) =>
      slot.kind === "trail" ? [slot.format] : [],
    );
    expect(formats).toHaveLength(2);
    for (const format of formats) expect(["tall", "wide"]).toContain(format);
    // A trail is never sized from a product bucket: its tile carries editorial
    // copy, so its shape is chosen, not measured.
    for (const format of formats) {
      expect(["1:1", "3:4", "4:3", "4:5"]).not.toContain(format);
    }
  });

  it("produces the same order twice for the same date seed", () => {
    const products = Array.from({ length: 24 }, (_, index) =>
      product(`p-${index}`),
    );
    const keys = () =>
      productSlots(
        buildWallSlots({ products, trails: [], seed: SEED }),
      ).map((slot) => slot.product.key);

    expect(keys()).toEqual(keys());
  });

  it("produces a different order for a different date seed", () => {
    const products = Array.from({ length: 24 }, (_, index) =>
      product(`p-${index}`),
    );
    const keysFor = (seed: string) =>
      productSlots(
        buildWallSlots({ products, trails: [], seed }),
      ).map((slot) => slot.product.key);

    expect(keysFor(SEED)).not.toEqual(keysFor(OTHER_SEED));
  });

  it("no longer emits anchor spans", async () => {
    const slots = buildWallSlots({
      products: Array.from({ length: 20 }, (_, index) => product(`p-${index}`)),
      trails: [trail("first", "/first.webp")],
      seed: SEED,
    });

    for (const slot of slots) {
      const values = Object.values(slot as Record<string, unknown>);
      expect(values).not.toContain("2x2");
      expect(values).not.toContain("2x1");
    }

    const wallModule = (await import("../home-wall")) as Record<string, unknown>;
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

    const slots = productSlots(
      buildWallSlots({ products, trails: [], seed: SEED }),
    );

    expect(slots).toHaveLength(16);
    expect(slots.map((slot) => slot.product.key)).toEqual(
      shuffleWithSeed(products, SEED)
        .slice(0, MAX_HOME_WALL_PRODUCTS)
        .map((entry) => entry.key),
    );
  });

  it("caps each brand at MAX_HOME_CURATED_PRODUCTS_PER_BRAND", () => {
    const shared = Array.from({ length: 5 }, (_, index) =>
      product(`shared-${index}`, { brandId: "brand-shared", category: "beauty" }),
    );
    const slots = buildWallSlots({
      products: [
        ...shared,
        ...Array.from({ length: 6 }, (_, index) =>
          product(`free-${index}`, { category: "home" }),
        ),
      ],
      trails: [],
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
      productSlots(buildWallSlots({ products, trails: [], seed }))
        .map((slot) => slot.product.key)
        .sort();

    expect(visiblePair(SEED)).toHaveLength(2);
    expect(visiblePair(SEED)).not.toEqual(visiblePair(OTHER_SEED));
  });
});

describe("wallSeedForDate", () => {
  it("resolves the calendar day in Asia/Taipei, not UTC", () => {
    // 23:30 UTC is already the next day in Taipei; a UTC seed would rotate the
    // wall eight hours late for every reader in Taiwan.
    expect(wallSeedForDate(new Date("2026-08-16T23:30:00Z"))).toBe("2026-08-17");
    expect(wallSeedForDate(new Date("2026-08-16T15:00:00Z"))).toBe("2026-08-16");
  });
});
