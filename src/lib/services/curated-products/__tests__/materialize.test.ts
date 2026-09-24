import { describe, expect, it } from "vitest";

import { materializeSubmissionCuratedProducts } from "../materialize";
import { getPublishedCuratedProductsForHomepage } from "@/lib/services/curated-products";
import type { CuratedProductSupabase } from "@/lib/services/curated-products";
import type { SubmissionProductReview } from "@/lib/services/submissions";
import type { CuratedProductProposal } from "@/lib/types/enriched-data";

const BRAND_ID = "22222222-2222-2222-2222-222222222222";
const SUBMISSION_ID = "33333333-3333-3333-3333-333333333333";

type ExistingRow = {
  id: string;
  brand_id: string;
  key: string;
  official_url: string | null;
  name_en: string | null;
  category: string;
  subcategory: string | null;
  image_source_url: string | null;
  product_description_zh: string;
  product_description_en: string | null;
  visible: boolean;
  proposed_by: string;
  curated_product_sources: { id: string }[];
};

type Recorded = {
  inserts: Record<string, unknown>[];
  upserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  tables: string[];
  ranges: [number, number][];
  maxConcurrentInserts: number;
};

/**
 * A chainable stand-in passed as an argument, never a module mock:
 * `scripts/check-test-boundaries.mjs` forbids `vi.mock` of `@/lib/services/`
 * and `@/lib/supabase/`, which is exactly why the materializer takes its client
 * (and its review layer) as parameters.
 *
 * Ceiling: it replays canned rows and records payloads. It does not evaluate a
 * filter, so "the read returned these rows" is stated by the fixture, not
 * proven — row-level behaviour belongs in the integration suite.
 */
function stubClient(options: {
  existing?: ExistingRow[];
  /** Thrown by the Nth source upsert, counting from 1. */
  failSourceUpsertAt?: number;
  failInsertKeys?: string[];
  insertDelayMs?: number;
}): { client: CuratedProductSupabase; calls: Recorded } {
  const calls: Recorded = {
    inserts: [],
    upserts: [],
    updates: [],
    tables: [],
    ranges: [],
    maxConcurrentInserts: 0,
  };
  let upsertCount = 0;
  let concurrentInserts = 0;
  const createdById = new Map<string, Record<string, unknown>>();

  function chainFor(table: string) {
    let insertedRow: Record<string, unknown> | null = null;
    let pendingUpdate: Record<string, unknown> | null = null;
    const chain = {
      select() {
        return chain;
      },
      eq(column: string, value: unknown) {
        if (pendingUpdate && column === "id") {
          const created = createdById.get(String(value));
          if (created) Object.assign(created, pendingUpdate);
        }
        return chain;
      },
      in() {
        return chain;
      },
      order() {
        return chain;
      },
      range(from: number, to: number) {
        calls.ranges.push([from, to]);
        return chain;
      },
      insert(row: Record<string, unknown>) {
        insertedRow = row;
        calls.inserts.push(row);
        return chain;
      },
      update(row: Record<string, unknown>) {
        calls.updates.push(row);
        pendingUpdate = row;
        return chain;
      },
      upsert(row: Record<string, unknown>) {
        upsertCount += 1;
        calls.upserts.push(row);
        const shouldFail = upsertCount === options.failSourceUpsertAt;
        return Promise.resolve(
          shouldFail
            ? { data: null, error: { code: "08006", message: "upsert failed" } }
            : { data: null, error: null },
        );
      },
      async single() {
        concurrentInserts += 1;
        calls.maxConcurrentInserts = Math.max(
          calls.maxConcurrentInserts,
          concurrentInserts,
        );
        if (options.insertDelayMs) {
          await new Promise((resolve) =>
            setTimeout(resolve, options.insertDelayMs),
          );
        }
        const key = String(insertedRow?.key ?? "");
        concurrentInserts -= 1;
        if (options.failInsertKeys?.includes(key)) {
          return {
            data: null,
            error: { code: "08006", message: "insert failed" },
          };
        }
        const id = `product-${key}`;
        if (insertedRow) createdById.set(id, insertedRow);
        return {
          data: { id, key },
          error: null,
        };
      },
      then<TResult>(
        resolve: (value: { data: unknown[] | null; error: unknown }) => TResult,
        reject?: (reason: unknown) => TResult,
      ) {
        const data =
          table === "curated_products" ? (options.existing ?? []) : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return chain;
  }

  const client = {
    from(table: string) {
      calls.tables.push(table);
      return chainFor(table);
    },
  };

  return { client: client as unknown as CuratedProductSupabase, calls };
}

function proposal(
  overrides: Partial<CuratedProductProposal> = {},
): CuratedProductProposal {
  return {
    key: "chai-shao-shou-kan-ma-ko-pei",
    nameZh: "柴燒手感馬克杯",
    nameEn: "Wood-fired Mug",
    category: "home",
    subcategory: "tableware",
    material: [],
    officialUrl: "https://taoqi.com.tw/products/wood-fired-mug",
    productDescriptionZh:
      "南投柴燒窯場燒製的馬克杯，杯身留有落灰痕跡，每一只的顏色都不同。",
    sources: [
      {
        url: "https://taoqi.com.tw/products/wood-fired-mug",
        sourceType: "official",
      },
    ],
    ...overrides,
  };
}

function review(
  products: CuratedProductProposal[],
  keptProductKeys?: string[],
): SubmissionProductReview {
  return { products, keptProductKeys };
}

describe("materializeSubmissionCuratedProducts", () => {
  it("stamps_source_checked_at — a kept proposal is publishable, not invisible", async () => {
    const { client, calls } = stubClient({});

    const result = await materializeSubmissionCuratedProducts(
      SUBMISSION_ID,
      BRAND_ID,
      { review: review([proposal()], [proposal().key]), client },
    );

    expect(result.created).toBe(1);
    expect(result.visible).toBe(1);
    const row = calls.inserts.at(0) ?? {};
    expect(typeof row.source_checked_at).toBe("string");
    expect(Number.isNaN(Date.parse(String(row.source_checked_at)))).toBe(false);
  });

  it("materialized_row_survives_the_public_read — the four-condition gate is satisfied", async () => {
    // The gate is `visible` AND `official_url` AND `source_checked_at` AND an
    // active source, and the homepage read re-checks three of them in
    // TypeScript. Feeding the ROW THE MATERIALIZER WROTE through that filter is
    // what proves approval publishes something: a NULL `source_checked_at` used
    // to leave a brand page with no curated section and no error anywhere.
    const { client, calls } = stubClient({});
    await materializeSubmissionCuratedProducts(SUBMISSION_ID, BRAND_ID, {
      review: review([proposal()], [proposal().key]),
      client,
    });
    const written = calls.inserts.at(0) ?? {};

    const published = await getPublishedCuratedProductsForHomepage(
      readRowClient({
        ...written,
        id: "product-key",
        key: written.key,
        image_url: "https://cdn.formoria.com/products/mug.jpg",
        image_width: 1200,
        image_height: 900,
        link_state: "ok",
        link_checked_at: null,
        created_at: "2026-08-19T00:00:00Z",
        curated_product_sources: [{ id: "source-1", state: "active" }],
        curated_product_selections: [],
        brands: {
          slug: "taoqi",
          name: "陶器工作室",
          status: "approved",
          purchase_website: "https://taoqi.com.tw",
        },
      }),
    );

    expect(published).toHaveLength(1);
    expect(published[0]?.key).toBe(written.key);
  });

  it("stores_the_proposal_key — rejection memory does not move when a reviewer renames", async () => {
    // The stored key is the axis the next run's diff falls back to. Re-deriving
    // it from the EDITED name stored a key no later proposal can match, so the
    // rejected product was re-offered and re-inserted as `…-2`.
    const { client, calls } = stubClient({});

    await materializeSubmissionCuratedProducts(SUBMISSION_ID, BRAND_ID, {
      review: review([proposal({ nameZh: "柴燒馬克杯（第二版）" })], []),
      client,
    });

    expect(calls.inserts.at(0)?.key).toBe(proposal().key);
    expect(calls.inserts.at(0)?.visible).toBe(false);
    // Rejection memory, not a checked product: nobody vouched for its sources.
    expect(calls.inserts.at(0)?.source_checked_at).toBeNull();
  });

  it("keeps a selected proposal without L2 hidden after its evidence is written", async () => {
    // Catches treating the review tick as sufficient to publish an unclassified product.
    const noL2 = proposal({ subcategory: null });
    const { client, calls } = stubClient({});

    const result = await materializeSubmissionCuratedProducts(
      SUBMISSION_ID,
      BRAND_ID,
      { review: review([noL2], [noL2.key]), client },
    );

    expect(result).toMatchObject({ created: 1, visible: 0, hidden: 1 });
    expect(calls.inserts.at(0)?.visible).toBe(false);
    expect(calls.updates).toEqual([]);
  });

  it("materializes twenty proposals with no more than four concurrent creates", async () => {
    // Catches restoring the five-product cap or launching one write chain per proposal.
    const proposals = Array.from({ length: 20 }, (_, index) =>
      proposal({
        key: `product-${index + 1}`,
        nameZh: `手作杯 ${index + 1}`,
        officialUrl: `https://taoqi.com.tw/products/cup-${index + 1}`,
        sources: [
          {
            url: `https://taoqi.com.tw/products/cup-${index + 1}`,
            sourceType: "official",
          },
        ],
      }),
    );
    const { client, calls } = stubClient({ insertDelayMs: 2 });

    const result = await materializeSubmissionCuratedProducts(
      SUBMISSION_ID,
      BRAND_ID,
      {
        review: review(
          proposals,
          proposals.map((item) => item.key),
        ),
        client,
      },
    );

    expect(result).toMatchObject({ created: 20, visible: 20, failed: 0 });
    expect(calls.maxConcurrentInserts).toBeGreaterThan(1);
    expect(calls.maxConcurrentInserts).toBeLessThanOrEqual(4);
  });

  it("skips_a_proposal_whose_official_url_was_emptied", async () => {
    // `""` is legal on a proposal so the section stays saveable mid-edit. It is
    // half the publication proof, so materializing it either publishes a row
    // that can never render or records a rejection for an unfinished edit.
    const { client, calls } = stubClient({});

    const result = await materializeSubmissionCuratedProducts(
      SUBMISSION_ID,
      BRAND_ID,
      {
        review: review([proposal({ officialUrl: "" })], [proposal().key]),
        client,
      },
    );

    expect(result).toMatchObject({ created: 0, skipped: 1, failed: 0 });
    expect(calls.inserts).toHaveLength(0);
  });

  it("dedupes_sources_by_url — concurrent upserts never share a conflict target", async () => {
    const { client, calls } = stubClient({});

    await materializeSubmissionCuratedProducts(SUBMISSION_ID, BRAND_ID, {
      review: review(
        [
          proposal({
            sources: [
              {
                url: "https://taoqi.com.tw/products/wood-fired-mug",
                sourceType: "official",
              },
              {
                url: "https://taoqi.com.tw/products/wood-fired-mug",
                sourceType: "official",
                claimZh: "重複引用",
              },
              {
                url: "https://taoqi.com.tw/about",
                sourceType: "official",
              },
            ],
          }),
        ],
        [proposal().key],
      ),
      client,
    });

    expect(calls.upserts.map((row) => row.url)).toEqual([
      "https://taoqi.com.tw/products/wood-fired-mug",
      "https://taoqi.com.tw/about",
    ]);
  });

  it("keeps_going_after_one_proposal_fails", async () => {
    const failing = proposal({
      key: "failing-product",
      nameZh: "會失敗的產品",
    });
    const healthy = proposal({
      key: "healthy-product",
      nameZh: "正常的產品",
      officialUrl: "https://taoqi.com.tw/products/tray",
      sources: [
        { url: "https://taoqi.com.tw/products/tray", sourceType: "official" },
      ],
    });
    const { client, calls } = stubClient({
      failInsertKeys: ["failing-product"],
    });

    const result = await materializeSubmissionCuratedProducts(
      SUBMISSION_ID,
      BRAND_ID,
      {
        review: review([failing, healthy], [failing.key, healthy.key]),
        client,
      },
    );

    expect(result).toMatchObject({ created: 1, failed: 1 });
    expect(calls.inserts.map((row) => row.key)).toEqual([
      "failing-product",
      "healthy-product",
    ]);
  });

  it("counts_a_source_failure_as_failed — the orphan it leaves is repairable, not silent", async () => {
    const { client, calls } = stubClient({ failSourceUpsertAt: 1 });

    const result = await materializeSubmissionCuratedProducts(
      SUBMISSION_ID,
      BRAND_ID,
      { review: review([proposal()], [proposal().key]), client },
    );

    // The product row landed; its evidence did not. `failed` is what tells the
    // caller the run was partial — it used to report a clean `created: 1`.
    expect(calls.inserts).toHaveLength(1);
    expect(result).toMatchObject({ created: 0, failed: 1 });
  });

  it("repairs_a_sourceless_row_instead_of_skipping_it", async () => {
    // A row whose create landed and whose sources did not is dropped by every
    // public read's `curated_product_sources!inner` evidence join. The diff
    // matches it, so a re-run used to be a NO-OP and the product was invisible
    // forever.
    const orphan: ExistingRow = {
      id: "orphaned-product",
      brand_id: BRAND_ID,
      key: proposal().key,
      official_url: proposal().officialUrl ?? null,
      name_en: proposal().nameEn ?? null,
      category: "home",
      subcategory: "tableware",
      image_source_url: null,
      product_description_zh: proposal().productDescriptionZh,
      product_description_en: null,
      visible: true,
      proposed_by: "generated",
      curated_product_sources: [],
    };
    const { client, calls } = stubClient({ existing: [orphan] });

    const result = await materializeSubmissionCuratedProducts(
      SUBMISSION_ID,
      BRAND_ID,
      { review: review([proposal()], [proposal().key]), client },
    );

    expect(result).toMatchObject({ created: 0, repaired: 1, skipped: 0 });
    expect(calls.inserts).toHaveLength(0);
    expect(calls.upserts.at(0)).toMatchObject({
      product_id: "orphaned-product",
      url: proposal().sources[0]?.url,
      state: "active",
    });
  });

  it("never_repairs_a_hand_entered_row — no citation there is a curator's decision", async () => {
    const handEntered: ExistingRow = {
      id: "hand-entered-product",
      brand_id: BRAND_ID,
      key: proposal().key,
      official_url: proposal().officialUrl ?? null,
      name_en: proposal().nameEn ?? null,
      category: "home",
      subcategory: "tableware",
      image_source_url: null,
      product_description_zh: proposal().productDescriptionZh,
      product_description_en: null,
      visible: true,
      proposed_by: "admin",
      curated_product_sources: [],
    };
    const { client, calls } = stubClient({ existing: [handEntered] });

    const result = await materializeSubmissionCuratedProducts(
      SUBMISSION_ID,
      BRAND_ID,
      { review: review([proposal()], [proposal().key]), client },
    );

    expect(result).toMatchObject({ created: 0, repaired: 0, skipped: 1 });
    expect(calls.upserts).toHaveLength(0);
  });

  it("still_skips_a_matched_row_that_has_its_evidence", async () => {
    const healthy: ExistingRow = {
      id: "existing-product",
      brand_id: BRAND_ID,
      key: proposal().key,
      official_url: proposal().officialUrl ?? null,
      name_en: proposal().nameEn ?? null,
      category: "home",
      subcategory: "tableware",
      image_source_url: null,
      product_description_zh: proposal().productDescriptionZh,
      product_description_en: null,
      visible: true,
      proposed_by: "generated",
      curated_product_sources: [{ id: "source-1" }],
    };
    const { client, calls } = stubClient({ existing: [healthy] });

    const result = await materializeSubmissionCuratedProducts(
      SUBMISSION_ID,
      BRAND_ID,
      { review: review([proposal()], [proposal().key]), client },
    );

    expect(result).toMatchObject({ created: 0, repaired: 0, skipped: 1 });
    expect(calls.upserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// rewriteGeneratedDescriptions (DEV-1709)
// ---------------------------------------------------------------------------

import {
  rewriteGeneratedDescriptions,
  type RewriteDescriptionsDeps,
  type GeneratedProductRow,
} from "../materialize";

function makeRewriteDeps(overrides: Partial<RewriteDescriptionsDeps> = {}): {
  deps: RewriteDescriptionsDeps;
  calls: {
    updateProduct: Array<{
      id: string;
      input: { productDescriptionZh: string };
    }>;
  };
} {
  const calls = {
    updateProduct: [] as Array<{
      id: string;
      input: { productDescriptionZh: string };
    }>,
  };
  const deps: RewriteDescriptionsDeps = {
    fetchGeneratedProducts:
      overrides.fetchGeneratedProducts ?? (async () => []),
    readPage:
      overrides.readPage ??
      (async (url) => ({
        url,
        title: "Test Product",
        description: "A test product",
        mainText: "Product details here",
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
        text: "Generate descriptions",
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
      (async (id, input) => {
        calls.updateProduct.push({ id, input });
      }),
  };
  return { deps, calls };
}

function generatedProduct(
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

describe("rewriteGeneratedDescriptions", () => {
  it("rewrites generated products on apply", async () => {
    const product = generatedProduct();
    const newDesc = "窯變釉色柴燒馬克杯，南投窯場手作燒製。";
    const { deps, calls } = makeRewriteDeps({
      fetchGeneratedProducts: async () => [product],
      callLlm: async () => ({
        text: JSON.stringify([
          { nameZh: product.nameZh, productDescriptionZh: newDesc },
        ]),
      }),
    });

    const result = await rewriteGeneratedDescriptions(deps, {
      apply: true,
    });

    expect(calls.updateProduct).toEqual([
      { id: "product-1", input: { productDescriptionZh: newDesc } },
    ]);
    expect(result.rewritten).toBe(1);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]).toMatchObject({
      id: "product-1",
      old: product.productDescriptionZh,
      new: newDesc,
    });
  });

  it("produces diffs without writing in dry-run", async () => {
    const product = generatedProduct();
    const newDesc = "窯變釉色柴燒馬克杯，南投窯場手作燒製。";
    const { deps, calls } = makeRewriteDeps({
      fetchGeneratedProducts: async () => [product],
      callLlm: async () => ({
        text: JSON.stringify([
          { nameZh: product.nameZh, productDescriptionZh: newDesc },
        ]),
      }),
    });

    const result = await rewriteGeneratedDescriptions(deps, {
      apply: false,
    });

    expect(calls.updateProduct).toEqual([]);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]).toMatchObject({
      old: product.productDescriptionZh,
      new: newDesc,
    });
  });

  it("skips products whose page read fails", async () => {
    const product = generatedProduct();
    const { deps } = makeRewriteDeps({
      fetchGeneratedProducts: async () => [product],
      readPage: async () => {
        throw new Error("connection refused");
      },
    });

    const result = await rewriteGeneratedDescriptions(deps, {
      apply: false,
    });

    expect(result.skipped).toEqual([
      expect.objectContaining({
        id: "product-1",
        reason: "page_read_failed",
      }),
    ]);
    expect(result.diffs).toHaveLength(0);
  });

  it("skips products failing verify checks", async () => {
    const product = generatedProduct();
    const newDesc = "某某某";
    const { deps } = makeRewriteDeps({
      fetchGeneratedProducts: async () => [product],
      callLlm: async () => ({
        text: JSON.stringify([
          { nameZh: product.nameZh, productDescriptionZh: newDesc },
        ]),
      }),
      verifyDescription: () => ["restates_name", "too_short"],
    });

    const result = await rewriteGeneratedDescriptions(deps, {
      apply: false,
    });

    expect(result.skipped).toEqual([
      expect.objectContaining({
        id: "product-1",
        reason: "verify_failed:restates_name,too_short",
      }),
    ]);
    expect(result.diffs).toHaveLength(0);
  });

  it("skips products with no official_url", async () => {
    const product = generatedProduct({ officialUrl: null });
    const { deps } = makeRewriteDeps({
      fetchGeneratedProducts: async () => [product],
    });

    const result = await rewriteGeneratedDescriptions(deps, {
      apply: false,
    });

    expect(result.skipped).toEqual([
      expect.objectContaining({
        id: "product-1",
        reason: "no_official_url",
      }),
    ]);
  });

  it("marks all brand products as failed when LLM returns non-array JSON", async () => {
    const product = generatedProduct();
    const { deps } = makeRewriteDeps({
      fetchGeneratedProducts: async () => [product],
      callLlm: async () => ({
        text: JSON.stringify({
          products: [
            { nameZh: product.nameZh, productDescriptionZh: "desc" },
          ],
        }),
      }),
    });

    const result = await rewriteGeneratedDescriptions(deps, {
      apply: false,
    });

    expect(result.failed).toEqual([
      expect.objectContaining({
        id: "product-1",
        error: expect.stringContaining("not a JSON array"),
      }),
    ]);
    expect(result.diffs).toHaveLength(0);
  });

  it("skips products with null or empty LLM description", async () => {
    const product1 = generatedProduct({
      id: "p1",
      nameZh: "杯A",
      brandSlug: "taoqi",
    });
    const product2 = generatedProduct({
      id: "p2",
      nameZh: "杯B",
      brandSlug: "taoqi",
    });
    const { deps } = makeRewriteDeps({
      fetchGeneratedProducts: async () => [product1, product2],
      callLlm: async () => ({
        text: JSON.stringify([
          { nameZh: "杯A", productDescriptionZh: null },
          { nameZh: "杯B", productDescriptionZh: "" },
        ]),
      }),
    });

    const result = await rewriteGeneratedDescriptions(deps, {
      apply: false,
    });

    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "p1",
          reason: "llm_invalid_description",
        }),
        expect.objectContaining({
          id: "p2",
          reason: "llm_invalid_description",
        }),
      ]),
    );
    expect(result.diffs).toHaveLength(0);
  });

  it("matches LLM output to products by nameZh", async () => {
    const product1 = generatedProduct({
      id: "p1",
      nameZh: "柴燒手感馬克杯",
      brandSlug: "taoqi",
    });
    const product2 = generatedProduct({
      id: "p2",
      nameZh: "手工陶盤",
      brandSlug: "taoqi",
    });
    const { deps, calls } = makeRewriteDeps({
      fetchGeneratedProducts: async () => [product1, product2],
      callLlm: async () => ({
        // Return in reverse order to verify matching by name, not position
        text: JSON.stringify([
          { nameZh: "手工陶盤", productDescriptionZh: "盤子描述" },
          { nameZh: "柴燒手感馬克杯", productDescriptionZh: "杯子描述" },
        ]),
      }),
    });

    const result = await rewriteGeneratedDescriptions(deps, {
      apply: true,
    });

    expect(result.rewritten).toBe(2);
    expect(calls.updateProduct).toEqual(
      expect.arrayContaining([
        { id: "p1", input: { productDescriptionZh: "杯子描述" } },
        { id: "p2", input: { productDescriptionZh: "盤子描述" } },
      ]),
    );
  });

  it("materialize_prompt_excludes_cross_page_chrome", async () => {
    const chrome =
      "Our studio newsletter arrives monthly with notes from the workshop, stories from the makers we admire, and seasonal letters from the hills.";
    const products = [1, 2, 3].map((n) =>
      generatedProduct({
        id: `p${n}`,
        nameZh: `柴燒杯 ${n}`,
        officialUrl: `https://taoqi.com.tw/products/cup-${n}`,
      }),
    );
    const userContents: string[] = [];
    const { deps } = makeRewriteDeps({
      fetchGeneratedProducts: async () => products,
      readPage: async (url) => {
        const blocks = [`Unique copy for ${url}, a wood-fired cup.`, chrome];
        return {
          url,
          title: "Test Product",
          description: "A test product",
          mainText: blocks.join(" "),
          blocks,
          images: [],
          jsonLd: null,
          productSignals: true,
          originExcerpts: [],
          rendered: false,
          statusCode: 200,
        };
      },
      callLlm: async (_system, user) => {
        userContents.push(user);
        return { text: "[]" };
      },
    });

    await rewriteGeneratedDescriptions(deps, { apply: false });

    expect(userContents).toHaveLength(1);
    expect(userContents[0]).toContain("Unique copy for https://taoqi.com.tw/products/cup-1");
    expect(userContents[0]).not.toContain(chrome);
  });

  it("skips duplicate nameZh within a brand", async () => {
    const product1 = generatedProduct({
      id: "p1",
      nameZh: "柴燒手感馬克杯",
      brandSlug: "taoqi",
    });
    const product2 = generatedProduct({
      id: "p2",
      nameZh: "柴燒手感馬克杯",
      brandSlug: "taoqi",
    });
    const { deps } = makeRewriteDeps({
      fetchGeneratedProducts: async () => [product1, product2],
      callLlm: async () => ({
        text: JSON.stringify([
          { nameZh: "柴燒手感馬克杯", productDescriptionZh: "新描述" },
        ]),
      }),
    });

    const result = await rewriteGeneratedDescriptions(deps, { apply: false });

    expect(result.skipped).toEqual([
      expect.objectContaining({
        id: "p2",
        reason: expect.stringContaining("duplicate_name_zh"),
      }),
    ]);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]?.id).toBe("p1");
  });
});

/** A one-row read client for the public homepage projection. */
function readRowClient(row: Record<string, unknown>): CuratedProductSupabase {
  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    neq: () => chain,
    order: () => chain,
    limit: () => chain,
    then<TResult>(
      resolve: (value: { data: unknown[]; error: null }) => TResult,
      reject?: (reason: unknown) => TResult,
    ) {
      return Promise.resolve({ data: [row], error: null }).then(
        resolve,
        reject,
      );
    },
  };
  return { from: () => chain } as unknown as CuratedProductSupabase;
}
