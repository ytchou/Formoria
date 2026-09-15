import { describe, expect, it, vi } from "vitest";
import {
  searchProductsBySituation,
  findSimilarProducts,
  findSimilarProductsForTrail,
  normalizeSituationQuery,
  SituationQueryError,
  _resetDegradationCooldown,
  CANDIDATE_POOL,
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
  productDescriptionZh: string;
  productDescriptionEn: string | null;
  brand: { slug: string; purchaseWebsite: string | null; purchasePinkoi: string | null; purchaseShopee: string | null; purchaseMyship: string | null; socialInstagram: string | null; socialThreads: string | null; socialFacebook: string | null };
};

function product(id: string, name: string, overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id,
    nameZh: name,
    nameEn: null,
    key: name.toLowerCase().replace(/\s/g, "-"),
    category: "home",
    subcategory: "tea",
    material: [],
    createdAt: "2026-01-01",
    imageUrl: null,
    officialUrl: null,
    brandSlug: "test-brand",
    brandName: "Test Brand",
    productDescriptionZh: "測試產品描述",
    productDescriptionEn: null,
    brand: { slug: "test-brand", purchaseWebsite: null, purchasePinkoi: null, purchaseShopee: null, purchaseMyship: null, socialInstagram: null, socialThreads: null, socialFacebook: null },
    ...overrides,
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
      mode: "hybrid",
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
      mode: "lexical",
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
    const p1 = product("p1", "Banana", { createdAt: "2026-03-01" });
    const p2 = product("p2", "Apple", { createdAt: "2026-01-01" });
    const p3 = product("p3", "Cherry", { createdAt: "2026-02-01" });

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

  // 9. CANDIDATE_POOL constant is the sole match_count source
  it("sends CANDIDATE_POOL as match_count regardless of page", async () => {
    const deps1 = createDeps({
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    const deps2 = createDeps({
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    await searchProductsBySituation(
      { query: "test query", locale: "zh-TW", page: 1, pageSize: 12 },
      deps1,
    );
    await searchProductsBySituation(
      { query: "test query", locale: "zh-TW", page: 3, pageSize: 12 },
      deps2,
    );

    const rpcArgs1 = (deps1.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    const rpcArgs2 = (deps2.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcArgs1[1].match_count).toBe(100);
    expect(rpcArgs2[1].match_count).toBe(100);
    expect(CANDIDATE_POOL).toBe(100);
  });

  // 10. searchSource is derived from effectiveMode, not top row's search_source
  it("reports the mode that ran, not the top row's arm", async () => {
    const deps = createDeps({
      rpc: vi.fn().mockResolvedValue({
        data: [
          rpcRow("p1", 0.9, "vector"),
          rpcRow("p2", 0.7, "both"),
        ],
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue([
        product("p1", "Product A"),
        product("p2", "Product B"),
      ]),
    });

    const result = await searchProductsBySituation(
      { query: "test query", locale: "zh-TW", mode: "hybrid" },
      deps,
    );
    expect(result.searchSource).toBe("hybrid");

    // vector mode with vector rows
    const deps2 = createDeps({
      rpc: vi.fn().mockResolvedValue({
        data: [rpcRow("p1", 0.9, "vector")],
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue([product("p1", "Product A")]),
    });

    const result2 = await searchProductsBySituation(
      { query: "test query", locale: "zh-TW", mode: "vector" },
      deps2,
    );
    expect(result2.searchSource).toBe("vector");
  });

  // 11. rpc and embed latency tracked from deps.now
  it("records rpc and embed latency from deps.now", async () => {
    const times = [0, 0, 40, 40, 100, 130];
    let callIndex = 0;
    const deps = createDeps({
      cache: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      now: vi.fn(() => times[callIndex++] ?? 130),
    });

    const result = await searchProductsBySituation(
      { query: "test query", locale: "zh-TW" },
      deps,
    );

    expect(result.embedLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.rpcLatencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.embedLatencyMs).toBe("number");
    expect(typeof result.rpcLatencyMs).toBe("number");
  });

  // 12. embed latency is 0 in lexical mode
  it("embed latency is 0 in lexical mode", async () => {
    const deps = createDeps({
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const result = await searchProductsBySituation(
      { query: "test query", locale: "zh-TW", mode: "lexical" },
      deps,
    );

    expect(deps.embed).not.toHaveBeenCalled();
    expect(result.embedLatencyMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. findSimilarProducts
// ---------------------------------------------------------------------------

describe("findSimilarProducts", () => {
  it("reads stored vector, excludes source product, truncates to limit", async () => {
    const storedEmbedding = [0.5, 0.6, 0.7];
    const deps = createDeps({
      readProductEmbedding: vi.fn().mockResolvedValue(storedEmbedding),
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

    // readProductEmbedding called with source product id
    expect(deps.readProductEmbedding).toHaveBeenCalledWith("p-source");

    // RPC called with vector mode and the stored embedding
    const rpcArgs = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcArgs[0]).toBe("search_products_semantic");
    expect(rpcArgs[1]).toMatchObject({
      mode: "vector",
      match_count: 6, // limit + 1
      query_embedding: storedEmbedding,
      filter_category: null,
      filter_subcategories: null,
      filter_materials: null,
    });

    // Source product excluded
    expect(result.products.map((p) => p.id)).not.toContain("p-source");
    expect(result.products).toHaveLength(2);
  });

  it("returns empty when no stored embedding exists", async () => {
    const deps = createDeps({
      readProductEmbedding: vi.fn().mockResolvedValue(null),
    });

    const result = await findSimilarProducts("p-missing", 5, deps);
    expect(result.products).toEqual([]);
    expect(deps.rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. searchProductsBySituation — intent parse integration
// ---------------------------------------------------------------------------

describe("searchProductsBySituation — intent parse", () => {
  // Uses real visible taxonomy values: "home" is a visible L1, "tea-and-coffee-ware" is an L2 under "home"
  const mockParsedResult = {
    category: "home" as const,
    subcategory: "tea-and-coffee-ware",
    materials: ["ceramic"],
  };

  const mockOutcome = {
    parsed: mockParsedResult,
    cacheHit: false,
  };

  it("runs intent parse in parallel when enabled", async () => {
    const parseIntent = vi.fn().mockResolvedValue(mockOutcome);
    const deps = createDeps({ parseIntent });

    await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      deps,
    );

    expect(parseIntent).toHaveBeenCalledWith("送禮推薦");
    expect(deps.embed).toHaveBeenCalledTimes(1);
  });

  it("skips intent parse when disabled", async () => {
    const parseIntent = vi.fn().mockResolvedValue(mockOutcome);
    const deps = createDeps({ parseIntent });

    await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );

    expect(parseIntent).not.toHaveBeenCalled();
  });

  it("merges LLM filters into RPC params", async () => {
    const parseIntent = vi.fn().mockResolvedValue(mockOutcome);
    const deps = createDeps({
      parseIntent,
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      deps,
    );

    const rpcArgs = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcArgs[1]).toMatchObject({
      filter_category: "home",
      filter_subcategories: ["tea-and-coffee-ware"],
      filter_materials: ["ceramic"],
    });
  });

  it("user filters override LLM", async () => {
    const parseIntent = vi.fn().mockResolvedValue(mockOutcome);
    const deps = createDeps({
      parseIntent,
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    await searchProductsBySituation(
      {
        query: "送禮推薦",
        locale: "zh-TW",
        enableIntentParse: true,
        category: "lifestyle",
        subcategories: ["outdoor"],
        materials: ["wood"],
      },
      deps,
    );

    const rpcArgs = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcArgs[1]).toMatchObject({
      filter_category: "lifestyle",
      filter_subcategories: ["outdoor"],
      filter_materials: ["wood"],
    });
  });

  it("falls back on intent parse null", async () => {
    const parseIntent = vi.fn().mockResolvedValue(null);
    const deps = createDeps({
      parseIntent,
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      deps,
    );

    const rpcArgs = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcArgs[1]).toMatchObject({
      filter_category: null,
      filter_subcategories: null,
      filter_materials: null,
    });
  });

  it("result includes intent metadata", async () => {
    let time = 1000;
    const parseIntent = vi.fn().mockResolvedValue(mockOutcome);
    const deps = createDeps({
      parseIntent,
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      now: vi.fn(() => {
        const t = time;
        time += 25;
        return t;
      }),
    });

    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      deps,
    );

    expect(result.intentParsed).toBe("ok");
    expect(result.intentCategory).toBe("home");
    expect(result.intentSubcategory).toBe("tea-and-coffee-ware");
    expect(result.intentMaterials).toEqual(["ceramic"]);
    expect(result.intentCacheHit).toBe(false);
    expect(result.intentLatencyMs).toBeGreaterThan(0);
  });

  it("converts subcategory to array for RPC", async () => {
    const parseIntent = vi.fn().mockResolvedValue({
      parsed: { ...mockParsedResult, materials: [] },
      cacheHit: false,
    });
    const deps = createDeps({
      parseIntent,
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      deps,
    );

    const rpcArgs = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcArgs[1].filter_subcategories).toEqual(["tea-and-coffee-ware"]);
  });

  it("sends null materials when empty", async () => {
    const parseIntent = vi.fn().mockResolvedValue({
      parsed: { ...mockParsedResult, materials: [] },
      cacheHit: false,
    });
    const deps = createDeps({
      parseIntent,
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      deps,
    );

    const rpcArgs = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcArgs[1].filter_materials).toBeNull();
  });

  it("respects 2s outer deadline", async () => {
    vi.useFakeTimers();
    try {
      const deps = createDeps({
        parseIntent: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
        rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
        now: vi.fn().mockReturnValue(1000),
      });

      const resultPromise = searchProductsBySituation(
        { query: "test query", locale: "zh-TW", enableIntentParse: true },
        deps,
      );

      await vi.advanceTimersByTimeAsync(2000);
      const result = await resultPromise;

      expect(result.intentParsed).toBe("failed");
      expect(deps.parseIntent).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // F2: LLM category bypasses isVisibleCategory
  it("nullifies LLM category when it fails isVisibleCategory", async () => {
    const parseIntent = vi.fn().mockResolvedValue({
      parsed: {
        category: "food-drink", // deferred category — not visible
        subcategory: "tea",
        materials: ["ceramic"],
      },
      cacheHit: false,
    });
    const deps = createDeps({
      parseIntent,
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      deps,
    );

    const rpcArgs = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcArgs[1]).toMatchObject({
      filter_category: null, // hidden category dropped
      filter_subcategories: null, // subcategory also dropped (category was hidden)
    });
  });

  // F5: subcategory validated against LLM not user category
  it("drops LLM subcategory when user category differs from LLM category", async () => {
    const parseIntent = vi.fn().mockResolvedValue({
      parsed: {
        category: "home",
        subcategory: "tea-and-coffee-ware",
        materials: [],
      },
      cacheHit: false,
    });
    const deps = createDeps({
      parseIntent,
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    await searchProductsBySituation(
      {
        query: "送禮推薦",
        locale: "zh-TW",
        enableIntentParse: true,
        category: "beauty", // different from LLM's "home"
      },
      deps,
    );

    const rpcArgs = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rpcArgs[1]).toMatchObject({
      filter_category: "beauty", // user's category wins
      filter_subcategories: null, // LLM subcategory dropped (incompatible with user category)
    });
  });

  // F9: parseIntent rejection fails closed → should fail open
  it("fails open when parseIntent rejects", async () => {
    const parseIntent = vi.fn().mockRejectedValue(new Error("LLM down"));
    const deps = createDeps({
      parseIntent,
      rpc: vi.fn().mockResolvedValue({
        data: [rpcRow("p1", 0.9)],
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue([product("p1", "Product A")]),
    });

    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      deps,
    );

    expect(result.products).toHaveLength(1);
    expect(result.intentParsed).toBe("failed");
  });

  // F11: intentParsed string enum states
  it("reports intentParsed as 'skipped' when intent parse is disabled", async () => {
    const deps = createDeps({
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );

    expect(result.intentParsed).toBe("skipped");
  });

  it("reports intentParsed as 'failed' when intent parse returns null", async () => {
    const parseIntent = vi.fn().mockResolvedValue(null);
    const deps = createDeps({
      parseIntent,
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      deps,
    );

    expect(result.intentParsed).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// 5. findSimilarProductsForTrail
// ---------------------------------------------------------------------------

describe("findSimilarProductsForTrail", () => {
  it("returns empty array for empty input", async () => {
    const deps = createDeps();
    const result = await findSimilarProductsForTrail([], 6, deps);
    expect(result).toEqual([]);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("excludes trail products from results", async () => {
    const trailProduct = product("trail-1", "Trail Tea Set");
    const similar1 = product("sim-1", "Similar Cup");
    const similar2 = product("sim-2", "Similar Pot");
    const similar3 = product("sim-3", "Similar Plate");

    const deps = createDeps({
      readProductEmbedding: vi.fn().mockResolvedValue(EMBEDDING),
      rpc: vi.fn().mockResolvedValue({
        data: [
          rpcRow("trail-1", 0.95), // trail product — must be excluded
          rpcRow("sim-1", 0.9),
          rpcRow("sim-2", 0.85),
          rpcRow("sim-3", 0.8),
        ],
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue([trailProduct, similar1, similar2, similar3]),
    });

    const result = await findSimilarProductsForTrail(["trail-1"], 6, deps);
    expect(result.map((p) => p.id)).not.toContain("trail-1");
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("caps at 1 product per brand", async () => {
    const brandA1 = product("a1", "Brand A Item 1", { brandSlug: "brand-a" });
    const brandA2 = product("a2", "Brand A Item 2", { brandSlug: "brand-a" });
    const brandB1 = product("b1", "Brand B Item 1", { brandSlug: "brand-b" });

    const deps = createDeps({
      readProductEmbedding: vi.fn().mockResolvedValue(EMBEDDING),
      rpc: vi.fn().mockResolvedValue({
        data: [rpcRow("a1", 0.9), rpcRow("a2", 0.85), rpcRow("b1", 0.8)],
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue([brandA1, brandA2, brandB1]),
    });

    const result = await findSimilarProductsForTrail(["trail-x"], 6, deps);
    const slugCounts = new Map<string, number>();
    for (const p of result) {
      slugCounts.set(p.brandSlug, (slugCounts.get(p.brandSlug) ?? 0) + 1);
    }
    for (const count of slugCounts.values()) {
      expect(count).toBeLessThanOrEqual(1);
    }
  });

  it("round-robin interleaves across trail products", async () => {
    const simA = product("sim-a", "From A", { brandSlug: "brand-a" });
    const simB = product("sim-b", "From B", { brandSlug: "brand-b" });
    const simC = product("sim-c", "From C", { brandSlug: "brand-c" });
    const simD = product("sim-d", "From D", { brandSlug: "brand-d" });

    let callCount = 0;
    const deps = createDeps({
      readProductEmbedding: vi.fn().mockResolvedValue(EMBEDDING),
      rpc: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ data: [rpcRow("sim-a", 0.9), rpcRow("sim-c", 0.8)], error: null });
        }
        return Promise.resolve({ data: [rpcRow("sim-b", 0.9), rpcRow("sim-d", 0.8)], error: null });
      }),
      hydrate: vi.fn().mockImplementation(({ ids }: { ids: string[] }) => {
        const all = [simA, simB, simC, simD];
        return Promise.resolve(all.filter((p) => ids.includes(p.id)));
      }),
    });

    const result = await findSimilarProductsForTrail(["t1", "t2"], 4, deps);
    // Round-robin: first round picks sim-a (from t1) then sim-b (from t2)
    // Second round picks sim-c (from t1) then sim-d (from t2)
    expect(result.map((p) => p.id)).toEqual(["sim-a", "sim-b", "sim-c", "sim-d"]);
  });

  it("respects limit", async () => {
    const products = Array.from({ length: 10 }, (_, i) =>
      product(`s${i}`, `Similar ${i}`, { brandSlug: `brand-${i}` }),
    );

    const deps = createDeps({
      readProductEmbedding: vi.fn().mockResolvedValue(EMBEDDING),
      rpc: vi.fn().mockResolvedValue({
        data: products.map((p, i) => rpcRow(p.id, 0.9 - i * 0.01)),
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue(products),
    });

    const result = await findSimilarProductsForTrail(["trail-x"], 3, deps);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("returns empty when all products have no embeddings", async () => {
    const deps = createDeps({
      readProductEmbedding: vi.fn().mockResolvedValue(null),
    });

    const result = await findSimilarProductsForTrail(["t1", "t2", "t3"], 6, deps);
    expect(result).toEqual([]);
  });
});
