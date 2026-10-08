import { describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import {
  searchProductsBySituation,
  findSimilarProducts,
  findSimilarProductsForTrail,
  normalizeSituationQuery,
  SituationQueryError,
  _resetDegradationCooldown,
  _resetLtrDegradationCooldown,
  CANDIDATE_POOL,
  RELEVANCE_COSINE_FLOOR,
  applyRelevanceFloor,
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

type TestRpcRow = {
  product_id: string;
  rank_score: number;
  search_source: string;
  vector_rank: number | null;
  lexical_rank: number | null;
  cosine_sim: number | null;
  lexical_score: number | null;
};

// Defaults describe a genuine match so the relevance floor (DEV-1964) keeps
// it: a non-"vector" row is a lexical hit, a non-"lexical" row clears the
// cosine floor. Floor tests pass explicit overrides.
function rpcRow(
  productId: string,
  score: number,
  source = "hybrid",
  overrides: Partial<TestRpcRow> = {},
): TestRpcRow {
  return {
    product_id: productId,
    rank_score: score,
    search_source: source,
    vector_rank: null,
    lexical_rank: source === "vector" ? null : 1,
    cosine_sim: source === "lexical" ? null : 0.5,
    lexical_score: null,
    ...overrides,
  };
}

/** A row only the vector arm returned, at the given cosine similarity. */
function vectorRow(productId: string, cosine: number | null): TestRpcRow {
  return rpcRow(productId, 0.5, "vector", { vector_rank: 1, cosine_sim: cosine });
}

/** A row the lexical arm matched, with the given (possibly weak) cosine. */
function lexicalRow(productId: string, cosine: number | null): TestRpcRow {
  return rpcRow(productId, 0.5, "both", { lexical_rank: 1, cosine_sim: cosine });
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
    expect(rpcArgs[1]).not.toHaveProperty("lexical_params");

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

    expect(result.embedLatencyMs).toBe(40);
    expect(result.rpcLatencyMs).toBe(60);
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
// appliedInference
// ---------------------------------------------------------------------------

describe("searchProductsBySituation — appliedInference", () => {
  const outcome = {
    parsed: {
      category: "home" as const,
      subcategory: "tea-and-coffee-ware",
      materials: ["metal"],
    },
    cacheHit: false,
  };

  function depsWithRows(parseIntent: SearchDeps["parseIntent"]) {
    return createDeps({
      parseIntent,
      rpc: vi.fn().mockResolvedValue({ data: [rpcRow("p1", 0.9)], error: null }),
      hydrate: vi.fn().mockResolvedValue([product("p1", "Product A")]),
    });
  }

  it("returns appliedInference with inferred category, subcategory and materials when no manual filters are set", async () => {
    const deps = depsWithRows(vi.fn().mockResolvedValue(outcome));

    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      deps,
    );

    const rpcParams = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(result.products).toHaveLength(1);
    expect(result.appliedInference).toEqual({
      category: rpcParams.filter_category,
      subcategory: rpcParams.filter_subcategories[0],
      materials: rpcParams.filter_materials,
    });
    expect(result.appliedInference).toEqual({
      category: "home",
      subcategory: "tea-and-coffee-ware",
      materials: ["metal"],
    });
  });

  it("manual filters win and are excluded from appliedInference", async () => {
    const deps = depsWithRows(vi.fn().mockResolvedValue(outcome));

    const result = await searchProductsBySituation(
      {
        query: "送禮推薦",
        locale: "zh-TW",
        enableIntentParse: true,
        materials: ["wood"],
      },
      deps,
    );

    const rpcParams = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(rpcParams.filter_materials).toEqual(["wood"]);
    expect(result.appliedInference.materials).toEqual([]);
    expect(result.appliedInference.category).toBe("home");
  });

  it("inferred materials are dropped when the resolved category has no materials", async () => {
    const deps = depsWithRows(
      vi.fn().mockResolvedValue({
        parsed: { category: "beauty", subcategory: null, materials: ["ceramic"] },
        cacheHit: false,
      }),
    );

    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      deps,
    );

    const rpcParams = (deps.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(rpcParams.filter_category).toBe("beauty");
    expect(rpcParams.filter_materials).toBeNull();
    expect(result.appliedInference.materials).toEqual([]);
  });

  it("hidden category is not reported", async () => {
    const deps = depsWithRows(
      vi.fn().mockResolvedValue({
        parsed: { category: "food-drink", subcategory: "tea", materials: [] },
        cacheHit: false,
      }),
    );

    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      deps,
    );

    expect(result.appliedInference.category).toBeNull();
    expect(result.appliedInference.subcategory).toBeNull();
  });

  it("subcategory dropped when manual category differs", async () => {
    const deps = depsWithRows(vi.fn().mockResolvedValue(outcome));

    const result = await searchProductsBySituation(
      {
        query: "送禮推薦",
        locale: "zh-TW",
        enableIntentParse: true,
        category: "beauty",
      },
      deps,
    );

    expect(result.appliedInference.category).toBeNull();
    expect(result.appliedInference.subcategory).toBeNull();
  });

  it("skipped or failed parse returns empty appliedInference", async () => {
    const empty = { category: null, subcategory: null, materials: [] };

    const skipped = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      depsWithRows(vi.fn().mockResolvedValue(outcome)),
    );
    expect(skipped.appliedInference).toEqual(empty);

    const failed = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      depsWithRows(vi.fn().mockResolvedValue(null)),
    );
    expect(failed.appliedInference).toEqual(empty);
  });

  it("empty-result return path also carries appliedInference", async () => {
    const deps = createDeps({
      parseIntent: vi.fn().mockResolvedValue(outcome),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", enableIntentParse: true },
      deps,
    );

    expect(result.products).toEqual([]);
    expect(result.appliedInference).toEqual({
      category: "home",
      subcategory: "tea-and-coffee-ware",
      materials: ["metal"],
    });
  });
});

// ---------------------------------------------------------------------------
// searchId
// ---------------------------------------------------------------------------

describe("searchProductsBySituation — searchId", () => {
  it("returns a searchId matching UUID pattern", async () => {
    const deps = createDeps({
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );

    expect(result.searchId).toMatch(/^[0-9a-f]{8}-/);
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

// ---------------------------------------------------------------------------
// 6. searchProductsBySituation — LTR scoring
// ---------------------------------------------------------------------------

describe("searchProductsBySituation — LTR scoring", () => {
  const p1 = product("p1", "Product A");
  const p2 = product("p2", "Product B");
  const p3 = product("p3", "Product C");

  function createLtrDeps(
    mode: string,
    overrides: Partial<SearchDeps> = {},
  ): SearchDeps {
    vi.stubEnv("SEARCH_LTR_MODE", mode);
    return createDeps({
      rpc: vi.fn().mockResolvedValue({
        data: [rpcRow("p1", 0.9), rpcRow("p2", 0.7), rpcRow("p3", 0.5)],
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue([p1, p2, p3]),
      // Scores: p1=0.3, p2=0.9, p3=0.6 → LTR order: p2, p3, p1
      ltrScore: vi.fn().mockResolvedValue([0.3, 0.9, 0.6]),
      ltrFeatures: vi.fn().mockResolvedValue(new Map()),
      ...overrides,
    });
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetLtrDegradationCooldown();
  });

  it("ltrMode off skips scoring entirely", async () => {
    const deps = createLtrDeps("off");
    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );
    expect(deps.ltrScore).not.toHaveBeenCalled();
    expect(result.ltrMode).toBeUndefined();
  });

  it("ltrMode shadow scores but serves RRF order", async () => {
    const deps = createLtrDeps("shadow");
    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );
    expect(deps.ltrScore).toHaveBeenCalledTimes(1);
    // Products stay in RRF order
    expect(result.products.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    // LTR fields populated
    expect(result.ltrMode).toBe("shadow");
    expect(result.ltrScores).toEqual([0.3, 0.9, 0.6]);
    expect(result.ltrProductKeys).toEqual(["p2", "p3", "p1"]);
    expect(result.rrfProductKeys).toEqual(["p1", "p2", "p3"]);
  });

  it("ltrMode interleave produces Team-Draft merged order", async () => {
    const deps = createLtrDeps("interleave");
    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );
    expect(deps.ltrScore).toHaveBeenCalledTimes(1);
    expect(result.ltrMode).toBe("interleave");
    expect(result.armBySlot).toBeDefined();
    expect(result.armBySlot!.length).toBe(3);
    // All products present
    expect(new Set(result.products.map((p) => p.id))).toEqual(
      new Set(["p1", "p2", "p3"]),
    );
  });

  it("ltrMode on serves LTR order", async () => {
    const deps = createLtrDeps("on");
    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );
    expect(deps.ltrScore).toHaveBeenCalledTimes(1);
    // Products sorted by LTR score desc: p2 (0.9) > p3 (0.6) > p1 (0.3)
    expect(result.products.map((p) => p.id)).toEqual(["p2", "p3", "p1"]);
    expect(result.ltrMode).toBe("on");
  });

  it("sort not relevance skips scoring", async () => {
    const deps = createLtrDeps("on");
    await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", sort: "newest" },
      deps,
    );
    expect(deps.ltrScore).not.toHaveBeenCalled();
  });

  it("scorer error falls back to RRF with degraded=true", async () => {
    const deps = createLtrDeps("shadow", {
      ltrScore: vi.fn().mockRejectedValue(new Error("ONNX crash")),
    });
    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("ltr");
    // Products in RRF order (fallback hydrate)
    expect(result.products.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("scorer error dedupes Sentry reports", async () => {
    _resetLtrDegradationCooldown();
    let clock = 1000;
    const report = vi.fn();

    const makeDeps = () =>
      createLtrDeps("shadow", {
        ltrScore: vi.fn().mockRejectedValue(new Error("ONNX crash")),
        report,
        now: vi.fn(() => clock),
      });

    // First failure — reports
    await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      makeDeps(),
    );
    expect(report).toHaveBeenCalledTimes(1);

    // 1 minute later — deduped
    clock += 60_000;
    await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      makeDeps(),
    );
    expect(report).toHaveBeenCalledTimes(1);

    // +5 minutes — reports again
    clock += 5 * 60_000;
    await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      makeDeps(),
    );
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("ltrLatencyMs and featuresLatencyMs are recorded", async () => {
    let tick = 0;
    const deps = createLtrDeps("shadow", {
      now: vi.fn(() => (tick += 10)),
    });
    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );
    expect(result.ltrLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.featuresLatencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.ltrLatencyMs).toBe("number");
    expect(typeof result.featuresLatencyMs).toBe("number");
  });

  it("empty rpcRows skip scoring", async () => {
    const deps = createLtrDeps("shadow", {
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );
    expect(deps.ltrScore).not.toHaveBeenCalled();
    expect(result.products).toEqual([]);
  });

  it("interleave mode filters armBySlot when hydrate drops candidates", async () => {
    const deps = createLtrDeps("interleave", {
      hydrate: vi.fn().mockResolvedValue([p1, p3]), // p2 dropped by hydrate
    });
    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );
    // Only p1 and p3 survived hydration
    expect(result.products).toHaveLength(2);
    expect(result.products.map((p) => p.id)).not.toContain("p2");
    // armBySlot must match surviving products, not the original displayOrder
    expect(result.armBySlot).toBeDefined();
    expect(result.armBySlot!.length).toBe(result.products.length);
    for (const arm of result.armBySlot!) {
      expect(["rrf", "ltr"]).toContain(arm);
    }
  });

  it("scorer length mismatch falls back to RRF", async () => {
    const deps = createLtrDeps("shadow", {
      // Return fewer scores than candidates — triggers length guard
      ltrScore: vi.fn().mockResolvedValue([0.5]),
    });
    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("ltr");
    // Falls back to RRF order via normal hydrate path
    expect(result.products.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("invalid SEARCH_LTR_MODE falls back to off", async () => {
    const deps = createLtrDeps("Interleave"); // wrong case — not a valid mode
    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );
    expect(deps.ltrScore).not.toHaveBeenCalled();
    expect(result.ltrMode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Relevance floor (DEV-1964) — totalCount is the post-floor count
// ---------------------------------------------------------------------------

describe("applyRelevanceFloor", () => {
  it("keeps lexical hits regardless of cosine and vector-only rows at or above the floor", () => {
    const rows = [
      vectorRow("v-high", 0.5),
      vectorRow("v-low", 0.2),
      lexicalRow("lex-null", null),
      vectorRow("v-at", RELEVANCE_COSINE_FLOOR),
      lexicalRow("lex-low", 0.1),
      vectorRow("v-null", null),
    ];
    const kept = applyRelevanceFloor(rows, { query: "送長輩的茶具", mode: "hybrid" });
    expect(kept.map((r) => r.product_id)).toEqual(["v-high", "lex-null", "v-at", "lex-low"]);
  });

  it("returns nothing for a Latin-only hybrid query with no lexical hit", () => {
    const rows = [vectorRow("v1", 0.6), vectorRow("v2", 0.5)];
    expect(applyRelevanceFloor(rows, { query: "asdfqwer", mode: "hybrid" })).toEqual([]);
  });

  it("applies the cosine rule to a Latin hybrid query that has a lexical hit", () => {
    const rows = [vectorRow("v-high", 0.6), lexicalRow("lex", 0.1), vectorRow("v-low", 0.2)];
    const kept = applyRelevanceFloor(rows, { query: "canvas bag", mode: "hybrid" });
    expect(kept.map((r) => r.product_id)).toEqual(["v-high", "lex"]);
  });

  it("does not fire the Latin gate in vector mode", () => {
    const rows = [vectorRow("v1", 0.6), vectorRow("v2", 0.2)];
    const kept = applyRelevanceFloor(rows, { query: "canvas bag", mode: "vector" });
    expect(kept.map((r) => r.product_id)).toEqual(["v1"]);
  });

  it("keeps every lexical-mode row (each is a lexical hit)", () => {
    const rows = [rpcRow("l1", 0.9, "lexical"), rpcRow("l2", 0.8, "lexical")];
    const kept = applyRelevanceFloor(rows, { query: "canvas", mode: "lexical" });
    expect(kept.map((r) => r.product_id)).toEqual(["l1", "l2"]);
  });

  it("does not mutate its input", () => {
    const rows = [vectorRow("v1", 0.6), vectorRow("v2", 0.1)];
    applyRelevanceFloor(rows, { query: "茶具", mode: "hybrid" });
    expect(rows.map((r) => r.product_id)).toEqual(["v1", "v2"]);
  });
});

describe("searchProductsBySituation — relevance floor", () => {
  function nonsensePool(): TestRpcRow[] {
    // 100 vector-only rows, cosine spread across 0.19–0.29 (staging max for
    // nonsense Latin queries was 0.2951).
    return Array.from({ length: CANDIDATE_POOL }, (_, i) =>
      vectorRow(`n${i}`, 0.19 + (i % 11) * 0.01),
    );
  }

  it.each(["asdfqwer", "qzxv"])(
    "nonsense query %s reports zero results instead of the candidate pool",
    async (query) => {
      const hydrate = vi.fn().mockResolvedValue([]);
      const deps = createDeps({
        rpc: vi.fn().mockResolvedValue({ data: nonsensePool(), error: null }),
        hydrate,
      });

      const result = await searchProductsBySituation(
        { query, locale: "zh-TW", mode: "hybrid" },
        deps,
      );

      expect(result.totalCount).toBe(0);
      expect(result.products).toEqual([]);
      expect(result.poolLimited).toBe(false);
      for (const call of hydrate.mock.calls) {
        expect(call[0].ids).toEqual([]);
      }
    },
  );

  it("Latin hybrid query with only vector rows above the floor returns nothing", async () => {
    const deps = createDeps({
      rpc: vi.fn().mockResolvedValue({
        data: [vectorRow("v1", 0.5), vectorRow("v2", 0.45)],
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue([product("v1", "A"), product("v2", "B")]),
    });

    const result = await searchProductsBySituation(
      { query: "asdfqwer", locale: "zh-TW", mode: "hybrid" },
      deps,
    );

    expect(result.totalCount).toBe(0);
    expect(result.products).toEqual([]);
  });

  it("Latin query in vector mode keeps rows above the floor", async () => {
    const deps = createDeps({
      rpc: vi.fn().mockResolvedValue({
        data: [vectorRow("v1", 0.5), vectorRow("v2", 0.45)],
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue([product("v1", "A"), product("v2", "B")]),
    });

    const result = await searchProductsBySituation(
      { query: "canvas bag", locale: "zh-TW", mode: "vector" },
      deps,
    );

    expect(result.products.map((p) => p.id)).toEqual(["v1", "v2"]);
    expect(result.totalCount).toBe(2);
  });

  it("Han query drops weak vector-only rows, keeps strong and lexical rows in order", async () => {
    const hydrate = vi.fn().mockResolvedValue([
      product("strong", "A"),
      product("lex-weak", "B"),
      product("lex-null", "C"),
      product("weak", "D"),
    ]);
    const deps = createDeps({
      rpc: vi.fn().mockResolvedValue({
        data: [
          vectorRow("strong", 0.6),
          vectorRow("weak", 0.2),
          lexicalRow("lex-weak", 0.1),
          vectorRow("null-cos", null),
          lexicalRow("lex-null", null),
        ],
        error: null,
      }),
      hydrate,
    });

    const result = await searchProductsBySituation(
      { query: "送長輩的茶具", locale: "zh-TW", mode: "hybrid" },
      deps,
    );

    expect(hydrate).toHaveBeenCalledWith({ ids: ["strong", "lex-weak", "lex-null"] });
    expect(result.products.map((p) => p.id)).toEqual(["strong", "lex-weak", "lex-null"]);
    expect(result.totalCount).toBe(3);
    expect(result.poolLimited).toBe(false);
  });

  it("relevanceFloor: false keeps the raw candidate pool", async () => {
    const pool = nonsensePool();
    const hydrate = vi.fn().mockResolvedValue(pool.map((r) => product(r.product_id, r.product_id)));
    const deps = createDeps({
      rpc: vi.fn().mockResolvedValue({ data: pool, error: null }),
      hydrate,
    });

    const result = await searchProductsBySituation(
      { query: "asdfqwer", locale: "zh-TW", mode: "hybrid", relevanceFloor: false },
      deps,
    );

    expect(hydrate).toHaveBeenCalledWith({ ids: pool.map((r) => r.product_id) });
    expect(result.totalCount).toBe(CANDIDATE_POOL);
  });

  it("poolLimited is true when the full candidate pool passes the floor", async () => {
    const pool = Array.from({ length: CANDIDATE_POOL }, (_, i) => vectorRow(`s${i}`, 0.6));
    const deps = createDeps({
      rpc: vi.fn().mockResolvedValue({ data: pool, error: null }),
      hydrate: vi.fn().mockResolvedValue(pool.map((r) => product(r.product_id, r.product_id))),
    });

    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", mode: "hybrid" },
      deps,
    );

    expect(result.totalCount).toBe(CANDIDATE_POOL);
    expect(result.poolLimited).toBe(true);
  });

  it("LTR scores one row per post-floor candidate", async () => {
    vi.stubEnv("SEARCH_LTR_MODE", "shadow");
    try {
      const ltrScore = vi.fn().mockResolvedValue([0.2, 0.8]);
      const deps = createDeps({
        rpc: vi.fn().mockResolvedValue({
          data: [vectorRow("keep-1", 0.6), vectorRow("drop", 0.1), lexicalRow("keep-2", null)],
          error: null,
        }),
        hydrate: vi.fn().mockResolvedValue([product("keep-1", "A"), product("keep-2", "B")]),
        ltrScore,
        ltrFeatures: vi.fn().mockResolvedValue(new Map()),
      });

      const result = await searchProductsBySituation(
        { query: "送禮推薦", locale: "zh-TW", mode: "hybrid" },
        deps,
      );

      expect(ltrScore.mock.calls[0]![0]).toHaveLength(2);
      expect(result.degraded).toBe(false);
      expect(result.rrfProductKeys).toEqual(["keep-1", "keep-2"]);
    } finally {
      vi.unstubAllEnvs();
      _resetLtrDegradationCooldown();
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Hidden L1 categories (DEV-1977) — search never surfaces a category
//    /discover hides, unless the caller chose that category
// ---------------------------------------------------------------------------

describe("searchProductsBySituation — hidden categories", () => {
  const visible = product("visible", "Visible", { category: "home" });
  const hidden = product("hidden", "Hidden", { category: "pets" });

  function createCategoryDeps(overrides: Partial<SearchDeps> = {}): SearchDeps {
    return createDeps({
      rpc: vi.fn().mockResolvedValue({
        data: [rpcRow("visible", 0.9), rpcRow("hidden", 0.8)],
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue([visible, hidden]),
      ...overrides,
    });
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetLtrDegradationCooldown();
  });

  it("drops products in a hidden category when no category is chosen", async () => {
    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      createCategoryDeps(),
    );

    expect(result.products.map((p) => p.id)).toEqual(["visible"]);
    expect(result.totalCount).toBe(1);
  });

  it("keeps hidden-category products when that category is chosen", async () => {
    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW", category: "pets" },
      createCategoryDeps(),
    );

    expect(result.products.map((p) => p.id)).toContain("hidden");
  });

  it("interleave mode drops the hidden product and keeps armBySlot aligned", async () => {
    vi.stubEnv("SEARCH_LTR_MODE", "interleave");
    const deps = createCategoryDeps({
      ltrScore: vi.fn().mockResolvedValue([0.2, 0.9]),
      ltrFeatures: vi.fn().mockResolvedValue(new Map()),
    });

    const result = await searchProductsBySituation(
      { query: "送禮推薦", locale: "zh-TW" },
      deps,
    );

    expect(result.ltrMode).toBe("interleave");
    expect(result.degraded).toBe(false);
    expect(result.products.map((p) => p.id)).toEqual(["visible"]);
    expect(result.armBySlot).toBeDefined();
    expect(result.armBySlot!.length).toBe(result.products.length);
    // Shadow-logging contracts stay full-pool.
    expect(result.ltrScores).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Diversification on the served path (DEV-1991)
// ---------------------------------------------------------------------------

describe("searchProductsBySituation — diversification", () => {
  const brand = (slug: string) => ({
    brandSlug: slug,
    brandName: slug,
    brand: { slug, purchaseWebsite: null, purchasePinkoi: null, purchaseShopee: null, purchaseMyship: null, socialInstagram: null, socialThreads: null, socialFacebook: null },
  });
  // a1 and a2 are size variants of one product (same name stem).
  const ranked = [
    product("a1", "陶瓷杯 350ml", brand("cups")),
    product("a2", "陶瓷杯 500ml", brand("cups")),
    product("a3", "玻璃壺", brand("cups")),
    product("b1", "茶壺", brand("teapots")),
  ];

  function diversifyDeps(overrides: Partial<SearchDeps> = {}): SearchDeps {
    return createDeps({
      rpc: vi.fn().mockResolvedValue({
        data: ranked.map((p, i) => rpcRow(p.id, 1 - i / 10)),
        error: null,
      }),
      hydrate: vi.fn().mockResolvedValue(ranked),
      ...overrides,
    });
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("moves a near-duplicate SKU down in the served relevance order", async () => {
    const result = await searchProductsBySituation(
      { query: "結婚禮物推薦", locale: "zh-TW" },
      diversifyDeps(),
    );
    expect(result.products.map((p) => p.id)).toEqual(["a1", "a3", "b1", "a2"]);
    expect(result.totalCount).toBe(4);
  });

  it("keeps the raw order for pool generation (relevanceFloor=false)", async () => {
    const result = await searchProductsBySituation(
      { query: "結婚禮物推薦", locale: "zh-TW", relevanceFloor: false },
      diversifyDeps(),
    );
    expect(result.products.map((p) => p.id)).toEqual(["a1", "a2", "a3", "b1"]);
  });

  it("leaves non-relevance sorts alone", async () => {
    const result = await searchProductsBySituation(
      { query: "結婚禮物推薦", locale: "zh-TW", sort: "newest" },
      diversifyDeps(),
    );
    expect(result.products.map((p) => p.id)).toEqual(["a1", "a2", "a3", "b1"]);
  });

  it("moves armBySlot with its product under interleave", async () => {
    vi.stubEnv("SEARCH_LTR_MODE", "interleave");
    // Team-Draft is seeded on searchId; pin it so both runs draw the same arms.
    const uuid = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000000");
    const deps = diversifyDeps({
      ltrScore: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4]),
      ltrFeatures: vi.fn().mockResolvedValue(new Map()),
    });
    const raw = await searchProductsBySituation(
      { query: "結婚禮物推薦", locale: "zh-TW", relevanceFloor: false },
      deps,
    );
    const served = await searchProductsBySituation(
      { query: "結婚禮物推薦", locale: "zh-TW" },
      deps,
    );
    uuid.mockRestore();

    const armOf = new Map(raw.products.map((p, i) => [p.id, raw.armBySlot![i]]));
    expect(served.armBySlot).toHaveLength(served.products.length);
    served.products.forEach((p, i) => {
      expect(served.armBySlot![i]).toBe(armOf.get(p.id));
    });
  });
});
