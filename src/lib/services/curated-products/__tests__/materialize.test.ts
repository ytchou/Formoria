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
  visible: boolean;
  proposed_by: string;
  curated_product_sources: { id: string }[];
};

type Recorded = {
  inserts: Record<string, unknown>[];
  upserts: Record<string, unknown>[];
  tables: string[];
  ranges: [number, number][];
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
}): { client: CuratedProductSupabase; calls: Recorded } {
  const calls: Recorded = {
    inserts: [],
    upserts: [],
    tables: [],
    ranges: [],
  };
  let upsertCount = 0;

  function chainFor(table: string) {
    let insertedRow: Record<string, unknown> | null = null;
    const chain = {
      select() {
        return chain;
      },
      eq() {
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
      single() {
        const key = String(insertedRow?.key ?? "");
        if (options.failInsertKeys?.includes(key)) {
          return Promise.resolve({
            data: null,
            error: { code: "08006", message: "insert failed" },
          });
        }
        return Promise.resolve({
          data: { id: `product-${key}`, key },
          error: null,
        });
      },
      then<TResult>(
        resolve: (value: {
          data: unknown[] | null;
          error: unknown;
        }) => TResult,
        reject?: (reason: unknown) => TResult,
      ) {
        const data = table === "curated_products" ? (options.existing ?? []) : [];
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
    category: "crafts",
    subcategories: [],
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

  it("skips_a_proposal_whose_official_url_was_emptied", async () => {
    // `""` is legal on a proposal so the section stays saveable mid-edit. It is
    // half the publication proof, so materializing it either publishes a row
    // that can never render or records a rejection for an unfinished edit.
    const { client, calls } = stubClient({});

    const result = await materializeSubmissionCuratedProducts(
      SUBMISSION_ID,
      BRAND_ID,
      { review: review([proposal({ officialUrl: "" })], [proposal().key]), client },
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
    const failing = proposal({ key: "failing-product", nameZh: "會失敗的產品" });
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
      { review: review([failing, healthy], [failing.key, healthy.key]), client },
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
      return Promise.resolve({ data: [row], error: null }).then(resolve, reject);
    },
  };
  return { from: () => chain } as unknown as CuratedProductSupabase;
}
