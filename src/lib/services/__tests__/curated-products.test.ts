import { describe, expect, it } from "vitest";
import {
  getPublishedCuratedProductsForBrand,
  type CuratedProductSupabase,
} from "../curated-products";

type QueryResult = {
  data?: unknown[] | null;
  error?: { code?: string; message: string } | null;
};

type RecordedCalls = {
  table: string[];
  select: string[];
  eq: [string, unknown][];
  not: [string, string, unknown][];
};

/**
 * Chainable stand-in passed as an argument, never a module mock:
 * `scripts/check-test-boundaries.mjs` forbids vi.mock of `@/lib/supabase/`, and
 * the service takes its client as a parameter precisely so it can be driven
 * this way.
 *
 * Ceiling: it records filters and replays one canned result — it does not
 * evaluate the filters. Row-level filtering behaviour belongs in
 * `curated-products.integration.test.ts`, against a real PostgREST.
 */
function stubClient(result: QueryResult): {
  client: CuratedProductSupabase;
  calls: RecordedCalls;
} {
  const calls: RecordedCalls = { table: [], select: [], eq: [], not: [] };
  const chain = {
    select(columns: string) {
      calls.select.push(columns);
      return chain;
    },
    eq(column: string, value: unknown) {
      calls.eq.push([column, value]);
      return chain;
    },
    not(column: string, operator: string, value: unknown) {
      calls.not.push([column, operator, value]);
      return chain;
    },
    then<TResult>(
      resolve: (value: {
        data: unknown[] | null;
        error: { code?: string; message: string } | null;
      }) => TResult,
      reject?: (reason: unknown) => TResult,
    ) {
      return Promise.resolve({
        data: result.data ?? null,
        error: result.error ?? null,
      }).then(resolve, reject);
    },
  };

  const client = {
    from(table: string) {
      calls.table.push(table);
      return chain;
    },
  };

  return { client: client as unknown as CuratedProductSupabase, calls };
}

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    brand_id: "22222222-2222-2222-2222-222222222222",
    key: "pick",
    name_zh: "Pick",
    name_en: "Pick",
    l1: "home",
    l2: ["tableware"],
    official_url: "https://example.com/pick",
    image_url: null,
    image_source_url: null,
    image_usage: "none",
    lifecycle: "published",
    link_state: "ok",
    link_checked_at: null,
    source_checked_at: "2026-08-13T00:00:00Z",
    review_due_at: null,
    notes_zh: null,
    notes_en: null,
    curated_product_selections: [],
    ...overrides,
  };
}

describe("getPublishedCuratedProductsForBrand", () => {
  it("counts only ACTIVE sources and selections as live", async () => {
    // The planner retires rather than deletes, so an unfiltered embed would let
    // a withdrawn source satisfy the evidence gate and a withdrawn selection
    // supply the public rationale and the sort position.
    const { client, calls } = stubClient({ data: [] });
    await getPublishedCuratedProductsForBrand("brand-1", client);

    expect(calls.select.at(0)).toContain("curated_product_sources!inner(id)");
    expect(calls.eq).toContainEqual(["curated_product_sources.state", "active"]);
    expect(calls.eq).toContainEqual([
      "curated_product_selections.state",
      "active",
    ]);
  });

  it("keeps the published + official_url + source_checked_at proof gate", async () => {
    const { client, calls } = stubClient({ data: [] });
    await getPublishedCuratedProductsForBrand("brand-1", client);

    expect(calls.table).toEqual(["curated_products"]);
    expect(calls.eq).toContainEqual(["brand_id", "brand-1"]);
    expect(calls.eq).toContainEqual(["lifecycle", "published"]);
    expect(calls.not).toContainEqual(["official_url", "is", null]);
    expect(calls.not).toContainEqual(["source_checked_at", "is", null]);
  });

  it("returns [] when the table is not in the PostgREST schema cache", async () => {
    // Deploys ship on push while migrations are applied by hand, so this window
    // is normal — and a throw here 500s every brand page.
    const { client } = stubClient({
      error: {
        code: "PGRST205",
        message:
          "Could not find the table 'public.curated_products' in the schema cache",
      },
    });

    await expect(
      getPublishedCuratedProductsForBrand("brand-1", client),
    ).resolves.toEqual([]);
  });

  it("rethrows any other error", async () => {
    const { client } = stubClient({
      error: { code: "42501", message: "permission denied" },
    });

    await expect(
      getPublishedCuratedProductsForBrand("brand-1", client),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps a product whose selections are all retired, sorted last with no rationale", async () => {
    // PostgREST returns the parent with an EMPTY embed once the retired
    // selections are filtered out; the product must still render.
    const { client } = stubClient({
      data: [
        productRow({
          id: "aaaaaaaa-0000-0000-0000-000000000000",
          key: "unplaced",
          curated_product_selections: [],
        }),
        productRow({
          id: "bbbbbbbb-0000-0000-0000-000000000000",
          key: "placed",
          curated_product_selections: [
            {
              trail_slug: "gifting",
              section_key: "picks",
              position: 2,
              rationale_zh: "Gifting angle",
              rationale_en: null,
            },
          ],
        }),
      ],
    });

    const products = await getPublishedCuratedProductsForBrand(
      "brand-1",
      client,
    );

    expect(products.map((product) => product.key)).toEqual([
      "placed",
      "unplaced",
    ]);
    const unplaced = products.at(1);
    expect(unplaced?.position).toBeNull();
    expect(unplaced?.rationaleZh).toBeNull();
    expect(unplaced?.trailSlug).toBeNull();
  });
});
