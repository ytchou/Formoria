import { describe, expect, it, vi } from "vitest";

import {
  buildExportRows,
  toFeatureCsv,
  sortByScores,
} from "../export-features";
import {
  FEATURE_NAMES,
  featureSpecHash,
  type RpcRow,
  type DocFeatures,
} from "@/lib/services/ltr-features";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDoc(id: string): DocFeatures {
  return {
    id,
    name_zh: "test",
    name_en: null,
    product_description_zh: "desc",
    product_description_en: null,
    image_url: null,
    image_width: null,
    image_height: null,
    material: [],
    subcategory: null,
    made_in_taiwan_confirmed: false,
    brand: { name: "brand", seo_promoted: false, model_faq_count: null },
  };
}

function makeRpcRow(
  productId: string,
  overrides: Partial<RpcRow> = {},
): RpcRow {
  return {
    product_id: productId,
    rank_score: 0.5,
    search_source: "both",
    vector_rank: 1,
    lexical_rank: 1,
    cosine_sim: 0.8,
    lexical_score: 0.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildExportRows
// ---------------------------------------------------------------------------

describe("buildExportRows", () => {
  it("joins grades onto the pool and defaults unjudged to 0", () => {
    const rpcRows = [makeRpcRow("p1"), makeRpcRow("p2"), makeRpcRow("p3")];
    const docs = new Map([
      ["p1", makeDoc("p1")],
      ["p2", makeDoc("p2")],
      ["p3", makeDoc("p3")],
    ]);
    const productMap = new Map([
      ["p1", { brandSlug: "a", key: "k1" }],
      ["p2", { brandSlug: "b", key: "k2" }],
      ["p3", { brandSlug: "c", key: "k3" }],
    ]);
    // p2 (b/k2) is unjudged — should default to 0
    const grades = new Map([
      ["a/k1", 3],
      ["c/k3", 1],
    ]);

    const rows = buildExportRows(
      "q1",
      rpcRows,
      docs,
      productMap,
      grades,
      "test query",
    );

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.grade)).toEqual([3, 0, 1]);
    expect(rows.every((r) => r.qid === "q1")).toBe(true);
  });

  it("joins rpc rows to hydrated products by product id, not index", () => {
    const rpcRows = [makeRpcRow("p1"), makeRpcRow("p2"), makeRpcRow("p3")];
    const docs = new Map([
      ["p1", makeDoc("p1")],
      ["p2", makeDoc("p2")],
      ["p3", makeDoc("p3")],
    ]);
    // p2 dropped by hydration (curated-products-catalog filters rows without
    // a canonical subcategory)
    const productMap = new Map([
      ["p1", { brandSlug: "a", key: "k1" }],
      ["p3", { brandSlug: "c", key: "k3" }],
    ]);
    const grades = new Map<string, number>();

    const rows = buildExportRows(
      "q1",
      rpcRows,
      docs,
      productMap,
      grades,
      "test query",
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]!.brandSlug).toBe("a");
    expect(rows[1]!.brandSlug).toBe("c");
  });

  it("warns when a graded pair is absent from the pool", () => {
    const rpcRows = [makeRpcRow("p1")];
    const docs = new Map([["p1", makeDoc("p1")]]);
    const productMap = new Map([["p1", { brandSlug: "a", key: "k1" }]]);
    const grades = new Map([
      ["a/k1", 3],
      ["b/k2", 2], // not in pool
    ]);

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = buildExportRows("q1", rpcRows, docs, productMap, grades, "test");
    expect(rows).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("b/k2"));
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// toFeatureCsv
// ---------------------------------------------------------------------------

describe("toFeatureCsv", () => {
  it("writes the header, the featureSpecHash line, and one row per candidate", () => {
    const features = new Float32Array(FEATURE_NAMES.length);
    features[0] = 0.5; // rrf_score — exact in float32

    const rows = [
      {
        qid: "q1",
        brandSlug: "brand-a",
        productKey: "prod-1",
        grade: 3,
        features,
      },
    ];

    const csv = toFeatureCsv(rows);
    const lines = csv.split("\n");

    // Line 1: header with feature names
    expect(lines[0]).toBe(
      `qid,brandSlug,productKey,grade,${FEATURE_NAMES.join(",")}`,
    );

    // Line 2: featureSpecHash comment
    expect(lines[1]).toBe(`# featureSpecHash=${featureSpecHash}`);

    // Line 3: data row
    expect(lines[2]).toContain("q1,brand-a,prod-1,3,");
    // First feature (rrf_score = 0.5)
    expect(lines[2]!.split(",")[4]).toBe("0.5");
  });
});

// ---------------------------------------------------------------------------
// sortByScores
// ---------------------------------------------------------------------------

describe("sortByScores", () => {
  it("ranks by scorer output descending and stays aligned by id", () => {
    const products = [
      { brandSlug: "a", key: "k1" },
      { brandSlug: "b", key: "k2" },
      { brandSlug: "c", key: "k3" },
    ];
    const scores = [0.1, 0.9, 0.5];

    const ranked = sortByScores(products, scores);

    expect(ranked).toEqual(["b/k2", "c/k3", "a/k1"]);
  });

  it("handles dropped hydration without shifting scores", () => {
    // Products array already has the dropped row removed — scores must stay
    // aligned by index, not by some external id mapping
    const products = [
      { brandSlug: "a", key: "k1" },
      { brandSlug: "c", key: "k3" },
    ];
    const scores = [0.3, 0.7];

    const ranked = sortByScores(products, scores);

    expect(ranked).toEqual(["c/k3", "a/k1"]);
  });
});
