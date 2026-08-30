import { describe, expect, it } from "vitest";
import {
  getPublishedCuratedProducts,
  interleaveCatalogProducts,
  transformCatalogRow,
  type CatalogProduct,
} from "../curated-products-catalog";

const baseRow = {
  id: "prod-1",
  key: "test-product",
  name_zh: "測試商品",
  name_en: "Test Product",
  category: "home",
  subcategory: "candles",
  created_at: "2026-08-29T12:00:00.000Z",
  image_url: "https://example.com/image.jpg",
  official_url: "https://example.com/product",
  brands: {
    slug: "test-brand",
    name: "Test Brand",
    status: "approved",
    purchase_website: "https://example.com",
    purchase_pinkoi: null,
    purchase_shopee: null,
    purchase_myship: null,
    social_instagram: "https://instagram.com/test",
    social_threads: null,
    social_facebook: null,
  },
};

describe("transformCatalogRow", () => {
  it("maps snake_case row to camelCase CatalogProduct", () => {
    const result = transformCatalogRow(baseRow);
    expect(result).toEqual({
      id: "prod-1",
      key: "test-product",
      nameZh: "測試商品",
      nameEn: "Test Product",
      category: "home",
      subcategory: "candles",
      material: [],
      createdAt: "2026-08-29T12:00:00.000Z",
      imageUrl: "https://example.com/image.jpg",
      officialUrl: "https://example.com/product",
      brandSlug: "test-brand",
      brandName: "Test Brand",
      brand: {
        slug: "test-brand",
        purchaseWebsite: "https://example.com",
        purchasePinkoi: null,
        purchaseShopee: null,
        purchaseMyship: null,
        socialInstagram: "https://instagram.com/test",
        socialThreads: null,
        socialFacebook: null,
      },
    });
  });

  it("handles null optional fields", () => {
    const row = {
      ...baseRow,
      name_en: null,
      brands: {
        ...baseRow.brands,
        purchase_website: null,
      },
    };
    const result = transformCatalogRow(row);
    expect(result.nameEn).toBeNull();
    expect(result.brand.purchaseWebsite).toBeNull();
  });

  it("adapts a compatible legacy singleton", () => {
    const { subcategory: _subcategory, ...legacyRow } = baseRow;
    const result = transformCatalogRow({
      ...legacyRow,
      subcategories: ["candles"],
    });
    expect(result.subcategory).toBe("candles");
  });

  it("rejects an ambiguous legacy array", () => {
    const { subcategory: _subcategory, ...legacyRow } = baseRow;
    expect(() =>
      transformCatalogRow({
        ...legacyRow,
        subcategories: ["candles", "home-fragrance"],
      }),
    ).toThrow("missing a canonical subcategory");
  });

  it("throws when brand join is missing", () => {
    const row = { ...baseRow, brands: null };
    expect(() => transformCatalogRow(row as never)).toThrow(
      "Catalog product prod-1 is missing its brand",
    );
  });
});

describe("interleaveCatalogProducts", () => {
  const product = (
    id: string,
    brandSlug: string,
    subcategory: string,
    createdAt: string,
  ): CatalogProduct => ({
    id,
    key: id,
    nameZh: id,
    nameEn: null,
    category: subcategory === "handbags" ? "bags-accessories" : "home",
    subcategory,
    material: [],
    createdAt,
    imageUrl: null,
    officialUrl: `https://example.com/${id}`,
    brandSlug,
    brandName: brandSlug,
    brand: {
      slug: brandSlug,
      purchaseWebsite: null,
      purchasePinkoi: null,
      purchaseShopee: null,
      purchaseMyship: null,
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
    },
  });

  it("round-robins brands while rotating L2 queues in recency order", () => {
    // Catches page slicing before interleaving and repeated same-brand or same-L2 runs.
    const products = [
      product("a-table-new", "alpha", "tableware", "2026-08-10T00:00:00Z"),
      product("b-bag-new", "beta", "handbags", "2026-08-09T00:00:00Z"),
      product("a-candle", "alpha", "candles", "2026-08-08T00:00:00Z"),
      product("b-bag-old", "beta", "handbags", "2026-08-07T00:00:00Z"),
      product("a-table-old", "alpha", "tableware", "2026-08-06T00:00:00Z"),
    ];

    const ordered = interleaveCatalogProducts(products);

    expect(ordered.map((entry) => entry.id)).toEqual([
      "a-table-new",
      "b-bag-new",
      "a-candle",
      "b-bag-old",
      "a-table-old",
    ]);
    expect(
      interleaveCatalogProducts(products).map((entry) => entry.id),
    ).toEqual(ordered.map((entry) => entry.id));
  });

  it("keeps L2 queue order after the first queue is depleted", () => {
    // Bug caught: deleting an empty first queue shifted the cursor from the
    // second queue to the third.
    const products = [
      product("tableware", "alpha", "tableware", "2026-08-10T00:00:00Z"),
      product(
        "tea-ware",
        "alpha",
        "tea-and-coffee-ware",
        "2026-08-09T00:00:00Z",
      ),
      product("cookware", "alpha", "cookware", "2026-08-08T00:00:00Z"),
    ];

    expect(
      interleaveCatalogProducts(products).map((entry) => entry.id),
    ).toEqual(["tableware", "tea-ware", "cookware"]);
  });
});

describe("getPublishedCuratedProducts", () => {
  /** Reusable mock client factory for query tests. */
  function createMockClient() {
    const ranges: [number, number][] = [];
    const equals: [string, unknown][] = [];
    const overlaps: [string, unknown][] = [];
    const orders: [string, { ascending: boolean }][] = [];
    const pages = [
      Array.from({ length: 500 }, (_, index) => ({
        ...baseRow,
        id: `product-${String(index).padStart(3, "0")}`,
        key: `product-${index}`,
        created_at: `2026-08-${String(28 - (index % 20)).padStart(2, "0")}T12:00:00.000Z`,
        image_url: null,
      })),
      [
        { ...baseRow, id: "product-500", key: "product-500", image_url: null },
        { ...baseRow, id: "product-501", key: "product-501", image_url: null },
      ],
    ];
    let pageIndex = 0;
    const chain = {
      select: () => chain,
      eq(column: string, value: unknown) {
        equals.push([column, value]);
        return chain;
      },
      not: () => chain,
      contains: () => chain,
      overlaps(column: string, value: unknown) {
        overlaps.push([column, value]);
        return chain;
      },
      order(column: string, opts: { ascending: boolean }) {
        orders.push([column, opts]);
        return chain;
      },
      range(from: number, to: number) {
        ranges.push([from, to]);
        return chain;
      },
      then<TResult>(
        resolve: (value: { data: unknown[]; error: null }) => TResult,
        reject?: (reason: unknown) => TResult,
      ) {
        const data = pages[pageIndex] ?? [];
        pageIndex += 1;
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    const client = { from: () => chain } as never;
    return { client, ranges, equals, overlaps, orders };
  }

  it("reads the full corpus in bounded ranges before slicing and uses overlaps for subcategory filter", async () => {
    const { client, ranges, overlaps } = createMockClient();

    const result = await getPublishedCuratedProducts(
      { category: "home", subcategories: ["candles"], page: 42, pageSize: 12 },
      client,
    );

    expect(ranges).toEqual([
      [0, 499],
      [500, 999],
    ]);
    expect(overlaps).toContainEqual(["subcategories", ["candles"]]);
    expect(result.totalCount).toBe(502);
    expect(result.products).toHaveLength(10);
    expect(result.products.every((product) => product.imageUrl === null)).toBe(
      true,
    );
  });

  it("filters by multiple subcategories using overlaps", async () => {
    const { client, overlaps } = createMockClient();

    await getPublishedCuratedProducts(
      { category: "home", subcategories: ["candles", "tableware"] },
      client,
    );

    expect(overlaps).toContainEqual([
      "subcategories",
      ["candles", "tableware"],
    ]);
  });

  it("filters by materials using overlaps", async () => {
    const { client, overlaps } = createMockClient();

    await getPublishedCuratedProducts(
      { category: "home", materials: ["ceramic", "wood"] },
      client,
    );

    expect(overlaps).toContainEqual(["material", ["ceramic", "wood"]]);
  });

  it("sorts alphabetical by name_zh when sort is alphabetical", async () => {
    const { client, orders } = createMockClient();

    await getPublishedCuratedProducts(
      { category: "home", sort: "alphabetical" },
      client,
    );

    // First order call per range should be name_zh ascending
    expect(orders).toContainEqual(["name_zh", { ascending: true }]);
    expect(orders).toContainEqual(["id", { ascending: true }]);
  });

  it("sorts by created_at desc by default (newest)", async () => {
    const { client, orders } = createMockClient();

    await getPublishedCuratedProducts({ category: "home" }, client);

    expect(orders).toContainEqual(["created_at", { ascending: false }]);
  });
});

describe("transformCatalogRow — material field", () => {
  it("includes material as string array", () => {
    const row = { ...baseRow, material: ["ceramic", "wood"] };
    const result = transformCatalogRow(row);
    expect(result.material).toEqual(["ceramic", "wood"]);
  });

  it("defaults material to empty array when null", () => {
    const row = { ...baseRow, material: null };
    const result = transformCatalogRow(row);
    expect(result.material).toEqual([]);
  });

  it("defaults material to empty array when absent", () => {
    const result = transformCatalogRow(baseRow);
    expect(result.material).toEqual([]);
  });
});
