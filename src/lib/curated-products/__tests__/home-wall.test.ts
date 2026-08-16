import { describe, expect, it } from "vitest";

import type { HomepageCuratedProduct } from "@/lib/services/curated-products";
import type { TrailEntry } from "@/lib/services/trails";
import {
  MAX_HOME_WALL_PRODUCTS,
  buildWallSlots,
  wallSeedForDate,
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
    imageWidth: 1200,
    imageHeight: 900,
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

function productSlots(slots: ReturnType<typeof buildWallSlots>["slots"]) {
  return slots.filter(
    (slot): slot is Extract<(typeof slots)[number], { kind: "product" }> =>
      slot.kind === "product",
  );
}

const SEED = "2026-08-16";
const OTHER_SEED = "2026-08-17";

describe("buildWallSlots", () => {
  it("reserves one trail slot per eight products", () => {
    const result = buildWallSlots({
      products: Array.from({ length: 16 }, (_, index) => product(`p-${index}`)),
      trails: [trail("first", "/first.webp"), trail("second", "/second.webp")],
      seed: SEED,
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
      seed: SEED,
    });

    expect(result.slots.some((slot) => slot.kind === "trail")).toBe(false);
    expect(result.leftoverTrails).toEqual([onlyTrail]);
  });

  it("caps the wall at MAX_HOME_WALL_PRODUCTS", () => {
    const result = buildWallSlots({
      products: Array.from({ length: 40 }, (_, index) => product(`p-${index}`)),
      trails: [],
      seed: SEED,
    });

    expect(productSlots(result.slots)).toHaveLength(MAX_HOME_WALL_PRODUCTS);
  });

  it("excludes trails without a heroImage", () => {
    const noHero = trail("no-hero");
    const result = buildWallSlots({
      products: Array.from({ length: 8 }, (_, index) => product(`p-${index}`)),
      trails: [noHero],
      seed: SEED,
    });

    expect(result.slots.some((slot) => slot.kind === "trail")).toBe(false);
    expect(result.leftoverTrails).toEqual([noHero]);
  });

  it("snaps each product to the nearest of four ratio buckets", () => {
    const result = buildWallSlots({
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
      productSlots(result.slots).map((slot) => [slot.product.key, slot.ratio]),
    );
    expect(ratios.get("square")).toBe("1:1");
    expect(ratios.get("three-four")).toBe("3:4");
    expect(ratios.get("four-three")).toBe("4:3");
    expect(ratios.get("four-five")).toBe("4:5");
    expect(ratios.get("banner")).toBe("4:3");
  });

  it("falls back to 4:3 when dimensions are null", () => {
    const result = buildWallSlots({
      products: [
        product("no-width", { imageWidth: null, imageHeight: 900 }),
        product("no-height", { imageWidth: 1200, imageHeight: null }),
      ],
      trails: [],
      seed: SEED,
    });

    expect(productSlots(result.slots).map((slot) => slot.ratio)).toEqual([
      "4:3",
      "4:3",
    ]);
  });

  it("assigns trails their own two formats", () => {
    const result = buildWallSlots({
      products: Array.from({ length: 24 }, (_, index) => product(`p-${index}`)),
      trails: [trail("first", "/first.webp"), trail("second", "/second.webp")],
      seed: SEED,
    });

    const formats = result.slots.flatMap((slot) =>
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
        buildWallSlots({ products, trails: [], seed: SEED }).slots,
      ).map((slot) => slot.product.key);

    expect(keys()).toEqual(keys());
  });

  it("produces a different order for a different date seed", () => {
    const products = Array.from({ length: 24 }, (_, index) =>
      product(`p-${index}`),
    );
    const keysFor = (seed: string) =>
      productSlots(
        buildWallSlots({ products, trails: [], seed }).slots,
      ).map((slot) => slot.product.key);

    expect(keysFor(SEED)).not.toEqual(keysFor(OTHER_SEED));
  });

  it("no longer emits anchor spans", async () => {
    const result = buildWallSlots({
      products: Array.from({ length: 20 }, (_, index) =>
        product(`p-${index}`, { wallPosition: index }),
      ),
      trails: [trail("first", "/first.webp")],
      seed: SEED,
    });

    for (const slot of result.slots) {
      const values = Object.values(slot as Record<string, unknown>);
      expect(values).not.toContain("2x2");
      expect(values).not.toContain("2x1");
    }

    const wallModule = (await import("../home-wall")) as Record<string, unknown>;
    expect(wallModule.MAX_HOME_WALL_ANCHOR_RATIO).toBeUndefined();
  });

  it("preserves the per-brand cap and the diversity window", () => {
    const products = [
      ...Array.from({ length: 12 }, (_, index) =>
        product(`home-${index}`, { l1: "home" }),
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        product(`beauty-${index}`, { l1: "beauty" }),
      ),
      // Three from one brand: the cap keeps two.
      ...Array.from({ length: 3 }, (_, index) =>
        product(`shared-${index}`, { brandId: "brand-shared", l1: "beauty" }),
      ),
    ];
    const slots = productSlots(
      buildWallSlots({ products, trails: [], seed: SEED }).slots,
    );

    expect(
      slots.filter((slot) => slot.product.brandId === "brand-shared"),
    ).toHaveLength(2);
    expect(
      slots.slice(0, 12).filter((slot) => slot.product.l1 === "home").length,
    ).toBeLessThanOrEqual(6);
  });

  it("pinned products always precede the shuffled remainder", () => {
    const products = [
      ...Array.from({ length: 20 }, (_, index) => product(`free-${index}`)),
      product("pin-b", { wallPosition: 2 }),
      product("pin-a", { wallPosition: 1 }),
    ];

    for (const seed of [SEED, OTHER_SEED]) {
      const keys = productSlots(
        buildWallSlots({ products, trails: [], seed }).slots,
      ).map((slot) => slot.product.key);

      expect(keys.slice(0, 2)).toEqual(["pin-a", "pin-b"]);
    }
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
