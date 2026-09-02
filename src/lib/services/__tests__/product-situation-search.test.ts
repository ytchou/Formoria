import { describe, expect, it, vi } from "vitest";
import {
  searchProductsBySituation,
  findSimilarProducts,
  normalizeSituationQuery,
  SituationQueryError,
  _resetDegradationCooldown,
  type SearchDeps,
} from "../product-situation-search";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CatalogProduct = {
  id: string;
  nameZh: string;
  nameEn: string | null;
  key: string;
  category: string;
  subcategory: string;
  material: string[];
  createdAt: string;
  imageUrl: string | null;
  officialUrl: string | null;
  brandSlug: string;
  brandName: string;
  brand: { slug: string; purchaseWebsite: string | null; purchasePinkoi: string | null; purchaseShopee: string | null; purchaseMyship: string | null; socialInstagram: string | null; socialThreads: string | null; socialFacebook: string | null };
};

function product(id: string, name: string, createdAt = "2026-01-01"): CatalogProduct {
  return {
    id,
    nameZh: name,
    nameEn: null,
    key: name.toLowerCase().replace(/\s/g, "-"),
    category: "home",
    subcategory: "tea",
    material: [],
    createdAt,
    imageUrl: null,
    officialUrl: null,
    brandSlug: "test-brand",
    brandName: "Test Brand",
    brand: { slug: "test-brand", purchaseWebsite: null, purchasePinkoi: null, purchaseShopee: null, purchaseMyship: null, socialInstagram: null, socialThreads: null, socialFacebook: null },
  };
}

function rpcRow(productId: string, score: number, source = "hybrid") {
  return { product_id: productId, rank_score: score, search_source: source };
}

const EMBEDDING = [0.1, 0.2, 0.3];

function createDeps(overrides: Partial<SearchDeps> = {}): SearchDeps {
  return {
    embed: vi.fn().mockResolvedValue(EMBEDDING),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    hydrate: vi.fn().mockResolvedValue([]),
    cache: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
    report: vi.fn(),
    now: vi.fn().mockReturnValue(Date.now()),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. normalizeSituationQuery
// ---------------------------------------------------------------------------

describe("normalizeSituationQuery", () => {
  it("trims and NFKC-normalizes", () => {
    // Full-width spaces collapse
    expect(normalizeSituationQuery("　hello　world　")).toBe("hello world");
  });

  it("rejects too_short (< 2 chars after normalize)", () => {
    expect(() => normalizeSituationQuery("　茶　")).toThrow(SituationQueryError);
    try {
      normalizeSituationQuery("a");
    } catch (e) {
      expect(e).toBeInstanceOf(SituationQueryError);
      expect((e as SituationQueryError).code).toBe("too_short");
    }
  });

  it("rejects too_long (> 200 chars)", () => {
    expect(() => normalizeSituationQuery("x".repeat(201))).toThrow(SituationQueryError);
    try {
      normalizeSituationQuery("x".repeat(201));
    } catch (e) {
      expect((e as SituationQueryError).code).toBe("too_long");
    }
  });

  it("rejects empty / whitespace-only", () => {
    expect(() => normalizeSituationQuery("")).toThrow(SituationQueryError);
    try {
      normalizeSituationQuery("   ");
    } catch (e) {
      expect((e as SituationQueryError).code).toBe("empty");
    }
  });

  it("rejects wildcard-only strings", () => {
    expect(() => normalizeSituationQuery("***")).toThrow(SituationQueryError);
    try {
      normalizeSituationQuery("%%");
    } catch (e) {
      expect((e as SituationQueryError).code).toBe("empty");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. searchProductsBySituation — hybrid, filters, hydrate in RPC order
// ---------------------------------------------------------------------------

describe("searchProductsBySituation", () => {
  it("embeds once, calls RPC with hybrid and filters, hydrates in RPC order", async () => {
    const p1 = product("p1", "Product A");
    const p2 = product("p2", "Product B");

    const deps = createDeps({
      rpc: vi.fn().mockResolvedValue({
        data: [rpcRow("p1", 0.9), rpcRow("p2", 0.7)],
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue([p2, p1]), // returned out of order
    });

    const result = await searchProductsBySituation(
      {
        query: "送禮推薦",
        locale: "zh-TW",
        mode: "hybrid",
        category: "food",
        subcategories: ["tea"],
        materials: ["ceramic"],
      },
      deps,
    );

    // Embed called once
    expect(deps.embed).toHaveBeenCalledTimes(1);

    // RPC called with correct args
    expect(deps.rpc).toHaveBeenCalledTimes(1);
    const rpcArgs = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcArgs[0]).toBe("search_products_semantic");
    expect(rpcArgs[1]).toMatchObject({
      query_text: "送禮推薦",
      query_embedding: EMBEDDING,
      search_mode: "hybrid",
      filter_category: "food",
      filter_subcategories: ["tea"],
      filter_materials: ["ceramic"],
    });

    // Hydrated in RPC order (p1 first, then p2)
    expect(result.products.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(result.degraded).toBe(false);
    expect(result.searchSource).toBe("hybrid");
  });

  // 3. audit.jobId reaches the embed context
  it("audit.jobId reaches the embeddings client context", async () => {
    const embedFactory = vi.fn().mockResolvedValue(EMBEDDING);
    const deps = createDeps({ embed: embedFactory });

    await searchProductsBySituation(
      {
        query: "送禮推薦",
        locale: "zh-TW",
        audit: { jobId: "job-123", phase: "situation_search" },
      },
      deps,
    );

    expect(embedFactory).toHaveBeenCalledWith(
      "送禮推薦",
      expect.objectContaining({ phase: "situation_search", jobId: "job-123" }),
    );
  });

  // 4. Falls back to lexical when embedding throws
  it("falls back to lexical when embedding throws", async () => {
    _resetDegradationCooldown();
    const deps = createDeps({
      embed: vi.fn().mockRejectedValue(new Error("OpenAI down")),
      rpc: vi.fn().mockResolvedValue({
        data: [rpcRow("p1", 0.5, "lexical")],
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue([product("p1", "Product A")]),
    });

    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );

    // RPC called with lexical mode and null embedding
    const rpcArgs = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcArgs[1]).toMatchObject({
      search_mode: "lexical",
      query_embedding: null,
    });

    expect(result.degraded).toBe(true);
    expect(result.searchSource).toBe("lexical");
    expect(deps.report).toHaveBeenCalledTimes(1);
  });

  // 5. Reports degradation to Sentry at most once per 5 minutes
  it("reports degradation at most once per 5 minutes", async () => {
    _resetDegradationCooldown();
    let clock = 1000;
    const deps = createDeps({
      embed: vi.fn().mockRejectedValue(new Error("fail")),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      hydrate: vi.fn().mockResolvedValue([]),
      now: vi.fn(() => clock),
    });

    // First failure — reports
    await searchProductsBySituation({ query: "test query", locale: "zh-TW" }, deps);
    expect(deps.report).toHaveBeenCalledTimes(1);

    // Second failure 1 minute later — deduped
    clock += 60_000;
    await searchProductsBySituation({ query: "test query", locale: "zh-TW" }, deps);
    expect(deps.report).toHaveBeenCalledTimes(1);

    // Third failure at +6 minutes — reports again
    clock += 5 * 60_000;
    await searchProductsBySituation({ query: "test query", locale: "zh-TW" }, deps);
    expect(deps.report).toHaveBeenCalledTimes(2);
  });

  // 6. Uses cache before embedding, stores after
  it("uses the cache before embedding and stores after", async () => {
    const cachedEmbedding = [0.4, 0.5, 0.6];
    const deps = createDeps({
      cache: {
        get: vi.fn().mockResolvedValue(cachedEmbedding),
        set: vi.fn().mockResolvedValue(undefined),
      },
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      hydrate: vi.fn().mockResolvedValue([]),
    });

    await searchProductsBySituation({ query: "cached query", locale: "zh-TW" }, deps);

    // Cache hit — embed not called
    expect(deps.embed).not.toHaveBeenCalled();
    // set not called on hit
    expect(deps.cache.set).not.toHaveBeenCalled();

    // Cache miss — embed called, then set
    const deps2 = createDeps({
      cache: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
      },
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      hydrate: vi.fn().mockResolvedValue([]),
    });

    await searchProductsBySituation({ query: "uncached query", locale: "zh-TW" }, deps2);
    expect(deps2.embed).toHaveBeenCalledTimes(1);
    expect(deps2.cache.set).toHaveBeenCalledTimes(1);
  });

  // 7. sort newest/alphabetical re-sorts; relevance keeps RPC order
  it("sort newest/alphabetical re-sorts the hydrated set; relevance keeps RPC order", async () => {
    const p1 = product("p1", "Banana", "2026-03-01");
    const p2 = product("p2", "Apple", "2026-01-01");
    const p3 = product("p3", "Cherry", "2026-02-01");

    const baseDeps = (_sort: "relevance" | "newest" | "alphabetical") =>
      createDeps({
        rpc: vi.fn().mockResolvedValue({
          data: [rpcRow("p1", 0.9), rpcRow("p2", 0.8), rpcRow("p3", 0.7)],
          error: null,
        }),
        hydrate: vi.fn().mockResolvedValue([p1, p2, p3]),
      });

    // Relevance — RPC order
    const r1 = await searchProductsBySituation(
      { query: "test query", locale: "zh-TW", sort: "relevance" },
      baseDeps("relevance"),
    );
    expect(r1.products.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);

    // Newest — by created_at descending
    const r2 = await searchProductsBySituation(
      { query: "test query", locale: "zh-TW", sort: "newest" },
      baseDeps("newest"),
    );
    expect(r2.products.map((p) => p.id)).toEqual(["p1", "p3", "p2"]);

    // Alphabetical — by name ascending
    const r3 = await searchProductsBySituation(
      { query: "test query", locale: "zh-TW", sort: "alphabetical" },
      baseDeps("alphabetical"),
    );
    expect(r3.products.map((p) => p.id)).toEqual(["p2", "p1", "p3"]);
  });

  // 8. Pages the hydrated set by pageSize
  it("pages the hydrated set by pageSize", async () => {
    const products = Array.from({ length: 5 }, (_, i) =>
      product(`p${i}`, `Product ${i}`),
    );
    const rpcData = products.map((p, i) => rpcRow(p.id, 1 - i * 0.1));

    const deps = createDeps({
      rpc: vi.fn().mockResolvedValue({ data: rpcData, error: null }),
      hydrate: vi.fn().mockResolvedValue(products),
    });

    const result = await searchProductsBySituation(
      { query: "test query", locale: "zh-TW", page: 2, pageSize: 2 },
      deps,
    );

    expect(result.products.map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(result.totalCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 9. findSimilarProducts
// ---------------------------------------------------------------------------

describe("findSimilarProducts", () => {
  it("reads stored vector, excludes source product", async () => {
    const deps = createDeps({
      rpc: vi.fn().mockResolvedValue({
        data: [rpcRow("p1", 0.9), rpcRow("p-source", 0.8), rpcRow("p2", 0.7)],
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue([
        product("p1", "Product 1"),
        product("p2", "Product 2"),
      ]),
    });

    const result = await findSimilarProducts("p-source", 5, deps);

    // RPC called with vector mode
    const rpcArgs = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcArgs[0]).toBe("search_products_semantic");
    expect(rpcArgs[1]).toMatchObject({
      search_mode: "vector",
      source_product_id: "p-source",
      match_count: 6, // limit + 1
    });

    // Source product excluded
    expect(result.products.map((p) => p.id)).not.toContain("p-source");
    expect(result.products).toHaveLength(2);
  });
});
