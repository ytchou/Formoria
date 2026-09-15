import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Task 3 mocks — relative paths bypass the boundary checker
// ---------------------------------------------------------------------------

vi.mock("../brands", () => ({
  getRelatedBrands: vi.fn(),
  getBrandsBySlugs: vi.fn(),
}));

import {
  refreshBrandCentroids,
  buildSourceHash,
  getRelatedBrandsByCentroid,
} from "../brand-embeddings";
import { getRelatedBrands, getBrandsBySlugs } from "../brands";
import type { Brand } from "@/lib/types/brand";

type WriterInput = {
  upserts: { brand_id: string; embedding: string; model: string; source_hash: string }[];
  deletes: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function vec(values: number[]): number[] {
  // Pad to 1536 dimensions with zeros for realistic tests
  const v = new Array(1536).fill(0);
  for (let i = 0; i < values.length; i++) v[i] = values[i];
  return v;
}

function makeBrand(overrides: Partial<Brand> & { slug: string }): Brand {
  return {
    id: overrides.id ?? overrides.slug,
    name: overrides.slug,
    description: null,
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    heroImageUrl: null,
    status: "approved",
    categorySlug: null,
    city: null,
    categoryLabel: null,
    isDemo: false,
    foundingYear: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    otherUrls: [],
    productPhotos: [],
    imageAlts: [],
    contactEmail: null,
    subcategories: [],
    subcategoriesEn: [],
    siteContent: null,
    submittedAt: "",
    approvedAt: null,
    createdAt: "",
    updatedAt: "",
    onboardingDismissedAt: null,
    officialSite: null,
    shopee: null,
    pinkoi: null,
    momo: null,
    eslite: null,
    pcHome: null,
    books: null,
    creemaJp: null,
    ...overrides,
  } as Brand;
}

// ---------------------------------------------------------------------------
// Task 2 — refreshBrandCentroids
// ---------------------------------------------------------------------------

describe("refreshBrandCentroids", () => {
  it("computes centroid from single product", async () => {
    const embedding = vec([1, 2, 3]);
    const writtenRows: unknown[] = [];

    const result = await refreshBrandCentroids({
      reader: async () => [
        {
          brandId: "brand-a",
          productIds: ["p1"],
          embeddings: [embedding],
          sourceHashes: ["abc"],
        },
      ],
      writer: async (input: WriterInput) => {
        writtenRows.push(...input.upserts);
      },
      existingReader: async () => new Map(),
    });

    expect(result.updated).toBe(1);
    const row = writtenRows[0] as { embedding: string };
    const written = JSON.parse(row.embedding) as number[];
    // Single product centroid equals the product's own embedding
    expect(written[0]).toBe(1);
    expect(written[1]).toBe(2);
    expect(written[2]).toBe(3);
  });

  it("computes centroid as element-wise mean of multiple products", async () => {
    const e1 = vec([3, 6, 9]);
    const e2 = vec([6, 12, 18]);
    const e3 = vec([0, 0, 0]);
    const writtenRows: unknown[] = [];

    await refreshBrandCentroids({
      reader: async () => [
        {
          brandId: "brand-a",
          productIds: ["p1", "p2", "p3"],
          embeddings: [e1, e2, e3],
          sourceHashes: ["h1", "h2", "h3"],
        },
      ],
      writer: async (input: WriterInput) => {
        writtenRows.push(...input.upserts);
      },
      existingReader: async () => new Map(),
    });

    const row = writtenRows[0] as { embedding: string };
    const written = JSON.parse(row.embedding) as number[];
    // Mean of [3,6,9], [6,12,18], [0,0,0] = [3,6,9]
    expect(written[0]).toBe(3);
    expect(written[1]).toBe(6);
    expect(written[2]).toBe(9);
  });

  it("source hash changes when product set changes", () => {
    const hash1 = buildSourceHash([
      { productId: "p1", sourceHash: "a" },
      { productId: "p2", sourceHash: "b" },
    ]);
    const hash2 = buildSourceHash([
      { productId: "p1", sourceHash: "a" },
      { productId: "p2", sourceHash: "b" },
      { productId: "p3", sourceHash: "c" },
    ]);
    expect(hash1).not.toBe(hash2);
    // Same inputs produce stable hash
    const hash1b = buildSourceHash([
      { productId: "p2", sourceHash: "b" },
      { productId: "p1", sourceHash: "a" },
    ]);
    expect(hash1).toBe(hash1b);
  });

  it("skips brands with unchanged hash", async () => {
    const embedding = vec([1, 2, 3]);
    const sourceHash = buildSourceHash([
      { productId: "p1", sourceHash: "abc" },
    ]);

    const result = await refreshBrandCentroids({
      reader: async () => [
        {
          brandId: "brand-a",
          productIds: ["p1"],
          embeddings: [embedding],
          sourceHashes: ["abc"],
        },
      ],
      writer: async () => {
        // Writer should not be called — brand is skipped
      },
      existingReader: async () =>
        new Map([["brand-a", sourceHash]]),
    });

    expect(result.skipped).toBeGreaterThan(0);
    expect(result.updated).toBe(0);
  });

  it("deletes orphaned centroids", async () => {
    const deletedIds: string[] = [];

    const result = await refreshBrandCentroids({
      reader: async () => [],
      writer: async (input: WriterInput) => {
        deletedIds.push(...input.deletes);
      },
      existingReader: async () =>
        new Map([["orphan-brand", "old-hash"]]),
    });

    expect(result.deleted).toBeGreaterThan(0);
    expect(deletedIds).toContain("orphan-brand");
  });

  it("dry run writes nothing", async () => {
    const embedding = vec([1, 2, 3]);
    const writer = vi.fn();

    const result = await refreshBrandCentroids({
      dryRun: true,
      reader: async () => [
        {
          brandId: "brand-a",
          productIds: ["p1"],
          embeddings: [embedding],
          sourceHashes: ["abc"],
        },
      ],
      writer,
      existingReader: async () => new Map(),
    });

    expect(writer).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
    expect(result.deleted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Task 3 — getRelatedBrandsByCentroid
// ---------------------------------------------------------------------------

describe("getRelatedBrandsByCentroid", () => {
  const mockedGetRelatedBrands = vi.mocked(getRelatedBrands);
  const mockedGetBrandsBySlugs = vi.mocked(getBrandsBySlugs);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns brands sorted by similarity", async () => {
    const brandA = makeBrand({ slug: "brand-a", subcategories: ["l2-a"] });
    const brandB = makeBrand({ slug: "brand-b", subcategories: ["l2-b"] });
    const brandC = makeBrand({ slug: "brand-c", subcategories: ["l2-c"] });

    mockedGetBrandsBySlugs.mockResolvedValue(
      new Map([
        ["brand-a", brandA],
        ["brand-b", brandB],
        ["brand-c", brandC],
      ]),
    );

    const result = await getRelatedBrandsByCentroid("source-id", "cat", "source-slug", 3, {
      centroidReader: async () => vec([1, 0, 0]),
      rpcCaller: async (_params) => [
        { slug: "brand-a", distance: 0.1 },
        { slug: "brand-b", distance: 0.3 },
        { slug: "brand-c", distance: 0.5 },
      ],
      countReader: async () => 10,
    });

    expect(result.brands[0]!.slug).toBe("brand-a");
    expect(result.brands[1]!.slug).toBe("brand-b");
    expect(result.brands[2]!.slug).toBe("brand-c");
  });

  it("falls back to random when no centroid exists", async () => {
    const fallbackResult = {
      brands: [makeBrand({ slug: "random-1" })],
      totalCount: 5,
    };
    mockedGetRelatedBrands.mockResolvedValue(fallbackResult);

    const result = await getRelatedBrandsByCentroid("source-id", "cat", "source-slug", 4, {
      centroidReader: async () => null,
      rpcCaller: async (_p) => [],
      countReader: async () => 0,
    });

    expect(mockedGetRelatedBrands).toHaveBeenCalledWith("cat", "source-slug", 4);
    expect(result).toBe(fallbackResult);
  });

  it("enforces L2 diversity cap", async () => {
    // 3 candidates all share "l2-shared"
    const brandA = makeBrand({ slug: "brand-a", subcategories: ["l2-shared"] });
    const brandB = makeBrand({ slug: "brand-b", subcategories: ["l2-shared"] });
    const brandC = makeBrand({ slug: "brand-c", subcategories: ["l2-unique"] });

    mockedGetBrandsBySlugs.mockResolvedValue(
      new Map([
        ["brand-a", brandA],
        ["brand-b", brandB],
        ["brand-c", brandC],
      ]),
    );

    const result = await getRelatedBrandsByCentroid("source-id", "cat", "source-slug", 4, {
      centroidReader: async () => vec([1, 0, 0]),
      rpcCaller: async (_p) => [
        { slug: "brand-a", distance: 0.1 },
        { slug: "brand-b", distance: 0.2 },
        { slug: "brand-c", distance: 0.3 },
      ],
      countReader: async () => 10,
    });

    // brand-a accepted (l2-shared enters seen set)
    // brand-b rejected (l2-shared already seen)
    // brand-c accepted (l2-unique not seen)
    expect(result.brands).toHaveLength(2);
    expect(result.brands.map((b: Brand) => b.slug)).toEqual(["brand-a", "brand-c"]);
  });

  it("backfills from next candidates when diversity cap removes one", async () => {
    const brandA = makeBrand({ slug: "brand-a", subcategories: ["l2-x"] });
    const brandB = makeBrand({ slug: "brand-b", subcategories: ["l2-x"] }); // blocked
    const brandC = makeBrand({ slug: "brand-c", subcategories: ["l2-y"] });
    const brandD = makeBrand({ slug: "brand-d", subcategories: ["l2-z"] });

    mockedGetBrandsBySlugs.mockResolvedValue(
      new Map([
        ["brand-a", brandA],
        ["brand-b", brandB],
        ["brand-c", brandC],
        ["brand-d", brandD],
      ]),
    );

    const result = await getRelatedBrandsByCentroid("source-id", "cat", "source-slug", 3, {
      centroidReader: async () => vec([1, 0, 0]),
      rpcCaller: async (_p) => [
        { slug: "brand-a", distance: 0.1 },
        { slug: "brand-b", distance: 0.2 },
        { slug: "brand-c", distance: 0.3 },
        { slug: "brand-d", distance: 0.4 },
      ],
      countReader: async () => 10,
    });

    expect(result.brands).toHaveLength(3);
    expect(result.brands.map((b: Brand) => b.slug)).toEqual([
      "brand-a",
      "brand-c",
      "brand-d",
    ]);
  });

  it("returns correct totalCount", async () => {
    const brandA = makeBrand({ slug: "brand-a", subcategories: [] });

    mockedGetBrandsBySlugs.mockResolvedValue(
      new Map([["brand-a", brandA]]),
    );

    const result = await getRelatedBrandsByCentroid("source-id", "cat", "source-slug", 4, {
      centroidReader: async () => vec([1, 0, 0]),
      rpcCaller: async (_p) => [
        { slug: "brand-a", distance: 0.1 },
      ],
      countReader: async () => 42,
    });

    expect(result.totalCount).toBe(42);
  });

  it("excludes source brand", async () => {
    const source = makeBrand({ slug: "source-slug", subcategories: [] });
    const other = makeBrand({ slug: "other", subcategories: [] });

    mockedGetBrandsBySlugs.mockResolvedValue(
      new Map([
        ["source-slug", source],
        ["other", other],
      ]),
    );

    const result = await getRelatedBrandsByCentroid("source-id", "cat", "source-slug", 4, {
      centroidReader: async () => vec([1, 0, 0]),
      rpcCaller: async (_p) => [
        { slug: "source-slug", distance: 0.05 },
        { slug: "other", distance: 0.2 },
      ],
      countReader: async () => 5,
    });

    expect(result.brands.map((b: Brand) => b.slug)).not.toContain("source-slug");
    expect(result.brands.map((b: Brand) => b.slug)).toContain("other");
  });
});
