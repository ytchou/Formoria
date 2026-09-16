import { describe, expect, it, vi } from "vitest";
import {
  FEATURE_SPEC,
  FEATURE_NAMES,
  featureSpecHash,
  LTR_DOC_SELECT,
  buildFeatureRows,
  bigramOverlap,
  fetchDocFeatures,
  type DocFeatures,
  type RpcRow,
} from "../ltr-features";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOCUMENTED_NAMES = [
  "rrf_score",
  "vector_rank",
  "lexical_rank",
  "cosine_sim",
  "lexical_score",
  "in_vector_arm",
  "in_lexical_arm",
  "bigram_overlap",
  "brand_name_hit",
  "product_name_hit",
  "desc_zh_len",
  "desc_en_len",
  "has_image",
  "image_area",
  "has_subcategory",
  "material_count",
  "faq_count",
  "seo_promoted",
  "made_in_taiwan_confirmed",
  "product_name_len",
] as const;

function makeDoc(overrides: Partial<DocFeatures> = {}): DocFeatures {
  return {
    id: "doc-1",
    name_zh: "测试产品",
    name_en: "Test Product",
    product_description_zh: "送給朋友的好礼物",
    product_description_en: "A gift for friends",
    image_url: "https://example.com/img.jpg",
    image_width: 800,
    image_height: 600,
    material: ["wood", "metal"],
    subcategory: "gifts",
    made_in_taiwan_confirmed: true,
    brand: {
      name: "TestBrand",
      seo_promoted: true,
      model_faq_count: 5,
    },
    ...overrides,
  };
}

function makeRpc(overrides: Partial<RpcRow> = {}): RpcRow {
  return {
    product_id: "doc-1",
    rank_score: 0.5,
    search_source: "both",
    vector_rank: 3,
    lexical_rank: 7,
    cosine_sim: 0.85,
    lexical_score: 12.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FEATURE_SPEC", () => {
  it("has 20 entries in the documented order and a stable hash", () => {
    expect(FEATURE_SPEC).toHaveLength(20);
    expect(FEATURE_NAMES).toHaveLength(20);

    for (let i = 0; i < DOCUMENTED_NAMES.length; i++) {
      expect(FEATURE_SPEC[i]!.name).toBe(DOCUMENTED_NAMES[i]);
      expect(FEATURE_NAMES[i]).toBe(DOCUMENTED_NAMES[i]);
    }

    expect(featureSpecHash).toBe(
      "a3745c54e2a4ed40323f1eefbf04a7a95f441cc7aef135a27f14d95d2d3bdf69",
    );
  });
});

describe("buildFeatureRows", () => {
  it("maps an absent arm to rank 101, score 0 and in_arm 0", () => {
    const rpc = makeRpc({
      vector_rank: null,
      cosine_sim: null,
    });
    const docs = new Map<string, DocFeatures>([["doc-1", makeDoc()]]);
    const rows = buildFeatureRows("test", [rpc], docs);

    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    // vector_rank (index 1) → 101
    expect(row[1]).toBe(101);
    // cosine_sim (index 3) → 0
    expect(row[3]).toBe(0);
    // in_vector_arm (index 5) → 0
    expect(row[5]).toBe(0);
    // lexical arm is present
    expect(row[2]).toBe(7); // lexical_rank
    expect(row[6]).toBe(1); // in_lexical_arm
  });

  it("rows are Float32Array of length FEATURE_NAMES.length (20)", () => {
    const rpc = makeRpc();
    const docs = new Map<string, DocFeatures>([["doc-1", makeDoc()]]);
    const rows = buildFeatureRows("test", [rpc], docs);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBeInstanceOf(Float32Array);
    expect(rows[0]!.length).toBe(FEATURE_NAMES.length);
  });

  it("log1p transforms apply to lengths, image area and faq count", () => {
    const doc = makeDoc({
      product_description_zh: "x".repeat(100),
      product_description_en: "y".repeat(50),
      image_width: 1000,
      image_height: 500,
      name_zh: "ab",
      brand: { name: "B", seo_promoted: false, model_faq_count: 10 },
    });
    const docs = new Map<string, DocFeatures>([["doc-1", doc]]);
    const rows = buildFeatureRows("test", [makeRpc()], docs);
    const row = rows[0]!;

    // desc_zh_len (index 10): Math.log1p(100)
    expect(row[10]).toBeCloseTo(Math.log1p(100), 4);
    // desc_en_len (index 11): Math.log1p(50)
    expect(row[11]).toBeCloseTo(Math.log1p(50), 4);
    // image_area (index 13): Math.log1p(1000 * 500)
    expect(row[13]).toBeCloseTo(Math.log1p(500_000), 4);
    // faq_count (index 16): Math.log1p(10)
    expect(row[16]).toBeCloseTo(Math.log1p(10), 4);
    // product_name_len (index 19): Math.log1p(2)
    expect(row[19]).toBeCloseTo(Math.log1p(2), 4);
  });

  it("brand_name_hit and product_name_hit are 1 only on substring match", () => {
    const doc = makeDoc({
      name_zh: "茶壺",
      name_en: "Teapot",
      brand: { name: "GreenLeaf", seo_promoted: false, model_faq_count: 0 },
    });
    const docs = new Map<string, DocFeatures>([["doc-1", doc]]);

    // Query contains brand name
    const rows1 = buildFeatureRows("greenleaf is great", [makeRpc()], docs);
    expect(rows1[0]![8]).toBe(1); // brand_name_hit
    expect(rows1[0]![9]).toBe(0); // product_name_hit (no match)

    // Query contains product name (en)
    const rows2 = buildFeatureRows("I want a teapot", [makeRpc()], docs);
    expect(rows2[0]![8]).toBe(0); // brand_name_hit
    expect(rows2[0]![9]).toBe(1); // product_name_hit

    // Query matches neither
    const rows3 = buildFeatureRows("random query", [makeRpc()], docs);
    expect(rows3[0]![8]).toBe(0);
    expect(rows3[0]![9]).toBe(0);
  });
});

describe("bigramOverlap", () => {
  it("counts query CJK bigrams present in the document", () => {
    // '送給朋友' = 4 chars, 3 bigrams: '送給', '給朋', '朋友'
    const query = "送給朋友";
    // Document contains '送給' and '朋友' but not '給朋'
    const doc = "送給的朋友";
    const overlap = bigramOverlap(query, doc);
    expect(overlap).toBeCloseTo(2 / 3, 5);
  });

  it("returns 0 when query has no CJK bigrams", () => {
    expect(bigramOverlap("abc", "some document")).toBe(0);
  });

  it("returns 0 for a single CJK character (no bigram possible)", () => {
    expect(bigramOverlap("茶", "茶壺")).toBe(0);
  });
});

describe("fetchDocFeatures", () => {
  it("selects only LTR_DOC_SELECT and chunks ids", async () => {
    const inFn = vi.fn().mockResolvedValue({
      data: [{ id: "a", name_zh: "test" }],
      error: null,
    });
    const selectFn = vi.fn().mockReturnValue({ in: inFn });
    const fromFn = vi.fn().mockReturnValue({ select: selectFn });
    const mockClient = { from: fromFn };

    // 150 ids → 2 chunks (100 + 50)
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    await fetchDocFeatures(ids, mockClient);

    expect(fromFn).toHaveBeenCalledWith("curated_products");
    expect(selectFn).toHaveBeenCalledWith(LTR_DOC_SELECT);
    expect(inFn).toHaveBeenCalledTimes(2);
    expect(inFn.mock.calls[0]![1]).toHaveLength(100);
    expect(inFn.mock.calls[1]![1]).toHaveLength(50);
  });

  it("returns empty map for empty ids", async () => {
    const result = await fetchDocFeatures([]);
    expect(result.size).toBe(0);
  });
});
