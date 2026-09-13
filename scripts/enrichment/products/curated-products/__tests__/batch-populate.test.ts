import { describe, expect, it } from "vitest";

import {
  batchPopulate,
  type BatchPopulateDeps,
  type BatchPopulateInput,
} from "../batch-populate";

/**
 * Batch-populate CLI wrapper (DEV-1609).
 *
 * Every seam is injected — `scripts/check-test-boundaries.mjs` forbids
 * vi.mock of service and supabase modules.
 */

function makeDeps(
  overrides: Partial<BatchPopulateDeps> = {},
): {
  deps: BatchPopulateDeps;
  calls: {
    resolveBrands: string[][];
    resolveRequester: string[];
    runBackfill: Array<{
      brandIds: string[];
      requester: { id: string; email: string };
    }>;
  };
  backfillResult: { jobId: string | null; outcomes: Array<{ brandId: string; submissionId: string | null; error: string | null }> };
} {
  const calls = {
    resolveBrands: [] as string[][],
    resolveRequester: [] as string[],
    runBackfill: [] as Array<{
      brandIds: string[];
      requester: { id: string; email: string };
    }>,
  };

  const backfillResult = {
    jobId: "job-001",
    outcomes: [
      { brandId: "brand-id-a", submissionId: "sub-a", error: null },
      { brandId: "brand-id-b", submissionId: "sub-b", error: null },
    ],
  };

  const deps: BatchPopulateDeps = {
    resolveBrands: overrides.resolveBrands ?? (async (slugs) => {
      calls.resolveBrands.push(slugs);
      return slugs.map((slug) => ({
        id: `brand-id-${slug.split("-").pop()}`,
        slug,
        purchase_website: `https://${slug}.example.com`,
      }));
    }),
    resolveRequester: overrides.resolveRequester ?? (async (email) => {
      calls.resolveRequester.push(email);
      return { id: "admin-uuid", email };
    }),
    runBackfill: overrides.runBackfill ?? (async (brandIds, requester) => {
      calls.runBackfill.push({ brandIds, requester });
      return backfillResult;
    }),
  };

  return { deps, calls, backfillResult };
}

function input(overrides: Partial<BatchPopulateInput> = {}): BatchPopulateInput {
  return {
    slugs: ["brand-a", "brand-b"],
    apply: false,
    adminEmail: "admin@formoria.com",
    ...overrides,
  };
}

describe("batchPopulate", () => {
  it("resolves slugs to brand IDs and throws on missing slugs", async () => {
    const { deps, calls } = makeDeps({
      resolveBrands: async (slugs) => {
        calls.resolveBrands.push(slugs);
        // Return only one of two requested slugs
        return [{ id: "brand-id-a", slug: "brand-a", purchase_website: "https://a.example.com" }];
      },
    });

    await expect(
      batchPopulate(input({ slugs: ["brand-a", "brand-missing"] }), deps),
    ).rejects.toThrow(/unresolved.*brand-missing/i);

    expect(calls.resolveBrands).toEqual([["brand-a", "brand-missing"]]);
  });

  it("dry run does not call backfill", async () => {
    const { deps, calls } = makeDeps();

    const result = await batchPopulate(input({ apply: false }), deps);

    expect(calls.runBackfill).toEqual([]);
    expect(calls.resolveRequester).toEqual([]);
    expect(result.mode).toBe("dry-run");
    expect(result.brands).toHaveLength(2);
  });

  it("apply calls backfill with resolved IDs and requester", async () => {
    const { deps, calls } = makeDeps();

    const result = await batchPopulate(
      input({ slugs: ["brand-a", "brand-b"], apply: true }),
      deps,
    );

    expect(calls.resolveRequester).toEqual(["admin@formoria.com"]);
    expect(calls.runBackfill).toEqual([
      {
        brandIds: ["brand-id-a", "brand-id-b"],
        requester: { id: "admin-uuid", email: "admin@formoria.com" },
      },
    ]);
    expect(result.mode).toBe("apply");
    expect(result.jobId).toBe("job-001");
  });

  it("reports per-brand outcome including submission IDs and errors", async () => {
    const { deps } = makeDeps({
      runBackfill: async () => ({
        jobId: "job-002",
        outcomes: [
          { brandId: "brand-id-a", submissionId: "sub-a", error: null },
          { brandId: "brand-id-b", submissionId: null, error: "A refresh is already pending for this brand" },
        ],
      }),
    });

    const result = await batchPopulate(
      input({ slugs: ["brand-a", "brand-b"], apply: true }),
      deps,
    );

    expect(result.outcomes).toEqual([
      { brandId: "brand-id-a", submissionId: "sub-a", error: null },
      { brandId: "brand-id-b", submissionId: null, error: "A refresh is already pending for this brand" },
    ]);
    expect(result.jobId).toBe("job-002");
  });

  it("throws when a brand has no purchase_website", async () => {
    const { deps } = makeDeps({
      resolveBrands: async () => [
        { id: "brand-id-a", slug: "brand-a", purchase_website: "https://a.example.com" },
        { id: "brand-id-b", slug: "brand-b", purchase_website: null },
      ],
    });

    await expect(
      batchPopulate(input({ slugs: ["brand-a", "brand-b"], apply: true }), deps),
    ).rejects.toThrow(/purchase_website.*brand-b/i);
  });
});

// ---------------------------------------------------------------------------
// rewrite-descriptions mode (DEV-1709)
// ---------------------------------------------------------------------------

import {
  rewriteGeneratedDescriptions,
  type RewriteDescriptionsDeps,
  type GeneratedProductRow,
} from "@/lib/services/curated-products/materialize";

function makeRewriteDeps(overrides: Partial<RewriteDescriptionsDeps> = {}): {
  deps: RewriteDescriptionsDeps;
  calls: {
    fetchGeneratedProducts: Array<string | undefined>;
    updateProduct: Array<{
      id: string;
      input: { productDescriptionZh: string };
    }>;
  };
} {
  const calls = {
    fetchGeneratedProducts: [] as Array<string | undefined>,
    updateProduct: [] as Array<{
      id: string;
      input: { productDescriptionZh: string };
    }>,
  };
  const deps: RewriteDescriptionsDeps = {
    fetchGeneratedProducts:
      overrides.fetchGeneratedProducts ??
      (async (slug) => {
        calls.fetchGeneratedProducts.push(slug);
        return [];
      }),
    readPage:
      overrides.readPage ??
      (async (url) => ({
        url,
        title: "Test",
        description: "Test",
        mainText: "Test content",
        images: [],
        jsonLd: null,
        productSignals: true,
        originExcerpts: [],
        rendered: false,
        statusCode: 200,
      })),
    fetchPrompt:
      overrides.fetchPrompt ??
      (async () => ({
        text: "Describe products",
        prompt: {
          name: "products-describe",
          version: 1,
          source: "snapshot" as const,
        },
      })),
    callLlm: overrides.callLlm ?? (async () => ({ text: "[]" })),
    verifyDescription: overrides.verifyDescription ?? (() => []),
    updateProduct:
      overrides.updateProduct ??
      (async (id, inp) => {
        calls.updateProduct.push({ id, input: inp });
      }),
  };
  return { deps, calls };
}

function rewriteProduct(
  overrides: Partial<GeneratedProductRow> = {},
): GeneratedProductRow {
  return {
    id: "product-1",
    nameZh: "柴燒手感馬克杯",
    officialUrl: "https://taoqi.com.tw/products/wood-fired-mug",
    category: "home",
    subcategory: "tableware",
    productDescriptionZh: "南投柴燒窯場燒製的馬克杯。",
    brandSlug: "taoqi",
    brandName: "陶器工作室",
    ...overrides,
  };
}

describe("rewrite-descriptions mode", () => {
  it("passes brandSlug to fetchGeneratedProducts and skips updateProduct on dry-run", async () => {
    const product = rewriteProduct();
    const { deps, calls } = makeRewriteDeps({
      fetchGeneratedProducts: async (slug) => {
        calls.fetchGeneratedProducts.push(slug);
        return [product];
      },
      callLlm: async () => ({
        text: JSON.stringify([
          {
            nameZh: product.nameZh,
            productDescriptionZh: "新描述",
          },
        ]),
      }),
    });

    const result = await rewriteGeneratedDescriptions(deps, {
      apply: false,
      brandSlug: "taoqi",
    });

    expect(calls.fetchGeneratedProducts).toEqual(["taoqi"]);
    expect(calls.updateProduct).toEqual([]);
    expect(result.rewritten).toBe(1);
  });

  it("returns correct summary counts from result", async () => {
    const p1 = rewriteProduct({ id: "p1", nameZh: "產品一" });
    const p2 = rewriteProduct({
      id: "p2",
      nameZh: "產品二",
      officialUrl: null,
    });
    const p3 = rewriteProduct({ id: "p3", nameZh: "產品三" });
    const { deps } = makeRewriteDeps({
      fetchGeneratedProducts: async () => [p1, p2, p3],
      callLlm: async () => ({
        text: JSON.stringify([
          { nameZh: "產品一", productDescriptionZh: "新描述一" },
          { nameZh: "產品三", productDescriptionZh: "新描述三" },
        ]),
      }),
    });

    const result = await rewriteGeneratedDescriptions(deps, {
      apply: true,
    });

    expect(result.total).toBe(3);
    expect(result.rewritten).toBe(2);
    // p2 skipped because officialUrl is null
    expect(result.skipped).toEqual([
      expect.objectContaining({ id: "p2", reason: "no_official_url" }),
    ]);
    expect(result.failed).toHaveLength(0);
  });
});
