import { describe, expect, it } from "vitest";
import {
  createCuratedProduct,
  CuratedProductSchemaLagError,
  curatedProductPromoteBlockers,
  getCuratedProductWriteContext,
  getPublishedCuratedProductsForHomepage,
  getPublishedCuratedProductsForBrand,
  getPublishedCuratedProductsForTrail,
  listCuratedProductsForAdmin,
  retireCuratedProductSelection,
  promoteCuratedProduct,
  retireCuratedProduct,
  retireCuratedProductSource,
  updateCuratedProduct,
  upsertCuratedProductSelection,
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
  in: [string, unknown[]][];
  not: [string, string, unknown][];
  limit: number[];
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
  const calls: RecordedCalls = {
    table: [],
    select: [],
    eq: [],
    in: [],
    not: [],
    limit: [],
  };
  const chain = {
    select(columns: string) {
      calls.select.push(columns);
      return chain;
    },
    eq(column: string, value: unknown) {
      calls.eq.push([column, value]);
      return chain;
    },
    in(column: string, values: unknown[]) {
      calls.in.push([column, values]);
      return chain;
    },
    not(column: string, operator: string, value: unknown) {
      calls.not.push([column, operator, value]);
      return chain;
    },
    limit(value: number) {
      calls.limit.push(value);
      return chain;
    },
    order() {
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
    highlight_position: null,
    highlight_rationale_zh: null,
    highlight_rationale_en: null,
    created_at: "2026-08-13T00:00:00Z",
    curated_product_selections: [],
    ...overrides,
  };
}

function trailProductRow(overrides: Record<string, unknown> = {}) {
  return productRow({
    brands: { slug: 'fixture-brand', name: 'Fixture Brand', status: 'approved' },
    curated_product_selections: [
      {
        trail_slug: 'small-space-reading-corner',
        section_key: 'first',
        position: 1,
        rationale_zh: 'Trail reason',
        rationale_en: 'Trail reason',
        state: 'active',
      },
    ],
    ...overrides,
  })
}

describe('getPublishedCuratedProductsForTrail', () => {
  it('keeps the four-condition publication gate and trail filters', async () => {
    const { client, calls } = stubClient({ data: [] })

    await getPublishedCuratedProductsForTrail('small-space-reading-corner', client)

    expect(calls.eq).toContainEqual(['lifecycle', 'published'])
    expect(calls.not).toContainEqual(['official_url', 'is', null])
    expect(calls.not).toContainEqual(['source_checked_at', 'is', null])
    expect(calls.eq).toContainEqual(['curated_product_sources.state', 'active'])
    expect(calls.eq).toContainEqual(['curated_product_selections.state', 'active'])
    expect(calls.eq).toContainEqual([
      'curated_product_selections.trail_slug',
      'small-space-reading-corner',
    ])
  })

  it.each([
    [
      'PGRST205',
      "Could not find the table 'public.curated_product_selections' in the schema cache",
    ],
    ['42703', 'column curated_products.highlight_position does not exist'],
  ])('rethrows a missing trail-read schema dependency (%s) so the route can demote the render', async (code, message) => {
    const { client } = stubClient({
      error: { code, message },
    })

    await expect(
      getPublishedCuratedProductsForTrail('small-space-reading-corner', client),
    ).rejects.toMatchObject({ code })
  })

  it('does not cap products per brand', async () => {
    const { client } = stubClient({
      data: [
        trailProductRow({ key: 'first' }),
        trailProductRow({ key: 'second' }),
        trailProductRow({ key: 'third' }),
      ],
    })

    const products = await getPublishedCuratedProductsForTrail(
      'small-space-reading-corner',
      client,
    )

    expect(products).toHaveLength(3)
    expect(products.every((product) => product.brandSlug === 'fixture-brand')).toBe(true)
  })

  it('uses the selection rationale, not the highlight rationale', async () => {
    const { client } = stubClient({
      data: [
        trailProductRow({
          highlight_rationale_zh: 'Brand-page reason',
          curated_product_selections: [
            {
              trail_slug: 'small-space-reading-corner',
              section_key: 'first',
              position: 1,
              rationale_zh: 'Trail-specific reason',
              rationale_en: 'Trail-specific reason',
              state: 'active',
            },
          ],
        }),
      ],
    })

    const [product] = await getPublishedCuratedProductsForTrail(
      'small-space-reading-corner',
      client,
    )

    expect(product?.rationaleZh).toBe('Trail-specific reason')
  })

  it('excludes retired selections', async () => {
    const { client } = stubClient({
      data: [
        trailProductRow({
          curated_product_selections: [
            {
              trail_slug: 'small-space-reading-corner',
              section_key: 'first',
              position: 1,
              rationale_zh: 'Retired reason',
              rationale_en: null,
              state: 'retired',
            },
          ],
        }),
      ],
    })

    await expect(
      getPublishedCuratedProductsForTrail('small-space-reading-corner', client),
    ).resolves.toEqual([])
  })

  it('orders equal-position selections deterministically by product key', async () => {
    const { client } = stubClient({
      data: [
        trailProductRow({ key: 'zeta' }),
        trailProductRow({ key: 'alpha' }),
      ],
    })

    const products = await getPublishedCuratedProductsForTrail(
      'small-space-reading-corner',
      client,
    )

    expect(products.map((product) => product.key)).toEqual(['alpha', 'zeta'])
  })
})

describe("getPublishedCuratedProductsForBrand", () => {
  it("counts only ACTIVE sources and selections as live", async () => {
    // The planner retires rather than deletes, so an unfiltered embed would let
    // a withdrawn source satisfy the evidence gate and a withdrawn selection
    // supply the public rationale and the sort position.
    const { client, calls } = stubClient({ data: [] });
    await getPublishedCuratedProductsForBrand("brand-1", client);

    expect(calls.select.at(0)).toContain("curated_product_sources!inner(id)");
    expect(calls.eq).toContainEqual([
      "curated_product_sources.state",
      "active",
    ]);
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

  it("returns [] when the highlight columns are not in the database yet", async () => {
    // The column probe against staging returned Postgres 42703. This deploy
    // window is distinct from PGRST205 (the table itself is already present).
    const { client } = stubClient({
      error: {
        code: "42703",
        message: "column curated_products.highlight_position does not exist",
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

  it("keeps a product whose selections are all retired, unhighlighted with no rationale", async () => {
    // PostgREST returns the parent with an EMPTY embed once the retired
    // selections are filtered out; the product must still render.
    const { client } = stubClient({
      data: [
        productRow({
          id: "aaaaaaaa-0000-0000-0000-000000000000",
          key: "unplaced",
          created_at: "2026-08-15T00:00:00Z",
          curated_product_selections: [],
        }),
        productRow({
          id: "bbbbbbbb-0000-0000-0000-000000000000",
          key: "placed",
          created_at: "2026-08-14T00:00:00Z",
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

  it("sorts highlighted products ahead of unhighlighted ones", async () => {
    const { client } = stubClient({
      data: [
        productRow({
          key: "unhighlighted",
          highlight_position: null,
          curated_product_selections: [
            {
              trail_slug: "gifting",
              section_key: "picks",
              position: 0,
              rationale_zh: "Trail first",
              rationale_en: null,
            },
          ],
        }),
        productRow({
          key: "highlighted",
          highlight_position: 1,
          highlight_rationale_zh: "Brand first",
          curated_product_selections: [
            {
              trail_slug: "gifting",
              section_key: "picks",
              position: 99,
              rationale_zh: "Trail last",
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
      "highlighted",
      "unhighlighted",
    ]);
  });

  it("orders the unhighlighted tail by created_at then key", async () => {
    const { client } = stubClient({
      data: [
        productRow({
          key: "newer",
          created_at: "2026-08-15T00:00:00Z",
          curated_product_selections: [
            {
              trail_slug: "gifting",
              section_key: "picks",
              position: 0,
              rationale_zh: "Trail first",
              rationale_en: null,
            },
          ],
        }),
        productRow({
          key: "older",
          created_at: "2026-08-14T00:00:00Z",
          curated_product_selections: [
            {
              trail_slug: "gifting",
              section_key: "picks",
              position: 99,
              rationale_zh: "Trail last",
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

    expect(products.map((product) => product.key)).toEqual(["older", "newer"]);
  });

  it("resolves the highlight rationale over the trail rationale", async () => {
    const { client } = stubClient({
      data: [
        productRow({
          highlight_position: 0,
          highlight_rationale_zh: "Brand-page reason",
          highlight_rationale_en: "Brand-page reason EN",
          curated_product_selections: [
            {
              trail_slug: "gifting",
              section_key: "picks",
              position: 1,
              rationale_zh: "Trail reason",
              rationale_en: "Trail reason EN",
            },
          ],
        }),
      ],
    });

    const [product] = await getPublishedCuratedProductsForBrand(
      "brand-1",
      client,
    );

    expect(product?.rationaleZh).toBe("Brand-page reason");
    expect(product?.rationaleEn).toBe("Brand-page reason EN");
  });

  it("falls back to the winning selection rationale when no highlight rationale exists", async () => {
    const { client } = stubClient({
      data: [
        productRow({
          curated_product_selections: [
            {
              trail_slug: "gifting",
              section_key: "picks",
              position: 1,
              rationale_zh: "Trail fallback",
              rationale_en: "Trail fallback EN",
            },
          ],
        }),
      ],
    });

    const [product] = await getPublishedCuratedProductsForBrand(
      "brand-1",
      client,
    );

    expect(product?.rationaleZh).toBe("Trail fallback");
    expect(product?.rationaleEn).toBe("Trail fallback EN");
  });

  it("keeps the highlight rationale when highlight_position is null", async () => {
    const { client } = stubClient({
      data: [
        productRow({
          highlight_position: null,
          highlight_rationale_zh: "Unordered brand reason",
          curated_product_selections: [],
        }),
      ],
    });

    const [product] = await getPublishedCuratedProductsForBrand(
      "brand-1",
      client,
    );

    expect(product?.highlightPosition).toBeNull();
    expect(product?.rationaleZh).toBe("Unordered brand reason");
  });
});

function homepageRow(overrides: Record<string, unknown> = {}) {
  return productRow({
    image_url: "https://images.example.com/selected-product.webp",
    image_usage: "permitted",
    curated_product_sources: [{ id: "source-1", state: "active" }],
    curated_product_selections: [
      {
        trail_slug: "picks",
        section_key: "home",
        position: 1,
        rationale_zh: "A considered pick",
        rationale_en: "A considered pick",
        state: "active",
      },
    ],
    wall_position: null,
    brands: {
      slug: "warmwood",
      name: "Warmwood",
      status: "approved",
    },
    ...overrides,
  });
}

describe("getPublishedCuratedProductsForHomepage", () => {
  it("returns only published products with active evidence", async () => {
    const { client } = stubClient({
      data: [
        homepageRow({ key: "live" }),
        homepageRow({
          key: "candidate",
          lifecycle: "candidate",
        }),
        homepageRow({
          key: "retired-source",
          curated_product_sources: [{ id: "source-2", state: "retired" }],
        }),
      ],
    });

    const products = await getPublishedCuratedProductsForHomepage(client);

    expect(products.map((product) => product.key)).toEqual(["live"]);
  });

  it("excludes unapproved and test brands", async () => {
    const { client } = stubClient({
      data: [
        homepageRow({ key: "approved" }),
        homepageRow({
          key: "hidden",
          brands: { slug: "hidden", name: "Hidden", status: "hidden" },
        }),
        homepageRow({
          key: "test",
          brands: {
            slug: "test",
            name: "[E2E-TEST] fixture",
            status: "approved",
          },
        }),
      ],
    });

    const products = await getPublishedCuratedProductsForHomepage(client);

    expect(products.map((product) => product.key)).toEqual(["approved"]);
  });

  it("accepts a highlight rationale when no trail selection exists", async () => {
    const { client, calls } = stubClient({
      data: [
        homepageRow({
          key: "highlight-only",
          curated_product_selections: [],
          highlight_rationale_zh: "品牌頁也值得被看見",
        }),
      ],
    });

    const [product] = await getPublishedCuratedProductsForHomepage(client);

    expect(product?.key).toBe("highlight-only");
    expect(product?.rationaleZh).toBe("品牌頁也值得被看見");
    expect(calls.select[0]).not.toContain("curated_product_selections!inner");
    expect(calls.not).not.toContainEqual([
      "curated_product_selections.rationale_zh",
      "is",
      null,
    ]);
  });

  // The read deliberately carries the whole published set: the per-brand cap
  // lives in the wall composer, AFTER the daily shuffle. Capping here would
  // freeze which two of a brand's products the shuffle can ever choose from.
  it("returns every published product of a brand, uncapped", async () => {
    const { client } = stubClient({
      data: [
        homepageRow({ key: "first", brand_id: "brand-1" }),
        homepageRow({
          key: "second",
          brand_id: "brand-1",
          curated_product_selections: [
            {
              trail_slug: "picks",
              section_key: "home",
              position: 2,
              rationale_zh: "Another angle",
              rationale_en: "Another angle",
              state: "active",
            },
          ],
        }),
        homepageRow({
          key: "third",
          brand_id: "brand-1",
          curated_product_selections: [
            {
              trail_slug: "picks",
              section_key: "home",
              position: 3,
              rationale_zh: "第三個角度",
              rationale_en: "A third angle",
              state: "active",
            },
          ],
        }),
        homepageRow({
          key: "other-brand",
          brand_id: "brand-2",
          brands: { slug: "other-brand", name: "Other Brand", status: "approved" },
        }),
      ],
    });

    const products = await getPublishedCuratedProductsForHomepage(client);

    expect(products.filter((product) => product.brandId === "brand-1")).toHaveLength(3);
    expect(products.map((product) => product.key)).toContain("other-brand");
  });

  it("filters unrenderable images", async () => {
    const { client } = stubClient({
      data: [
        homepageRow({ key: "licensed", image_usage: "licensed" }),
        homepageRow({ key: "none", image_usage: "none" }),
      ],
    });

    const products = await getPublishedCuratedProductsForHomepage(client);

    expect(products.map((product) => product.key)).toEqual(["licensed"]);
  });

  it("orders deterministically and bounds the query", async () => {
    const rows = [
      homepageRow({
        key: "brand-beta",
        brand_id: "brand-beta",
        wall_position: 1,
        brands: { slug: "brand-beta", name: "Beta", status: "approved" },
        curated_product_selections: [
          {
            trail_slug: "picks",
            section_key: "home",
            position: 100,
            rationale_zh: "Beta reason",
            rationale_en: "Beta reason",
            state: "active",
          },
        ],
      }),
      homepageRow({
        key: "zeta",
        brand_id: "brand-alpha",
        wall_position: 1,
        brands: { slug: "alpha", name: "Alpha", status: "approved" },
        curated_product_selections: [
          {
            trail_slug: "picks",
            section_key: "home",
            position: 0,
            rationale_zh: "Alpha zeta reason",
            rationale_en: "Alpha zeta reason",
            state: "active",
          },
        ],
      }),
      homepageRow({
        key: "alpha",
        brand_id: "brand-alpha",
        wall_position: 1,
        brands: { slug: "alpha", name: "Alpha", status: "approved" },
        curated_product_selections: [
          {
            trail_slug: "picks",
            section_key: "home",
            position: 99,
            rationale_zh: "Alpha alpha reason",
            rationale_en: "Alpha alpha reason",
            state: "active",
          },
        ],
      }),
      homepageRow({
        key: "later",
        brand_id: "brand-later",
        wall_position: 3,
        brands: { slug: "later", name: "Later", status: "approved" },
        curated_product_selections: [],
        highlight_rationale_zh: "Later reason",
      }),
      homepageRow({
        key: "unplaced",
        brand_id: "brand-unplaced",
        wall_position: null,
        brands: { slug: "unplaced", name: "Unplaced", status: "approved" },
        curated_product_selections: [],
        highlight_rationale_zh: "Unplaced reason",
      }),
    ];
    const first = stubClient({ data: rows });
    const second = stubClient({ data: rows });

    const firstProducts = await getPublishedCuratedProductsForHomepage(
      first.client,
    );
    const secondProducts = await getPublishedCuratedProductsForHomepage(
      second.client,
    );

    expect(firstProducts.map((product) => product.key)).toEqual([
      "alpha",
      "zeta",
      "brand-beta",
      "later",
      "unplaced",
    ]);
    expect(firstProducts.map((product) => product.key)).toEqual(
      secondProducts.map((product) => product.key),
    );
    expect(first.calls.limit).toEqual([1_000]);
    expect(first.calls.select[0]).not.toContain("curated_product_selections!inner");
    expect(first.calls.not).not.toContainEqual([
      "curated_product_selections.rationale_zh",
      "is",
      null,
    ]);
    expect(first.calls.in).toContainEqual([
      "image_usage",
      ["permitted", "licensed"],
    ]);
  });

  it("excludes a product with neither rationale source", async () => {
    const { client } = stubClient({
      data: [
        homepageRow({
          key: "without-rationale",
          curated_product_selections: [],
          highlight_rationale_zh: null,
        }),
      ],
    });

    await expect(getPublishedCuratedProductsForHomepage(client)).resolves.toEqual(
      [],
    );
  });

  // A missing table or column means the schema is older than this code, which
  // for the homepage is NOT the same as "nothing is published". `[]` would drop
  // the whole selection zone from a `●` prerender and cache it for an hour with
  // a green build and nothing in Sentry — how the wall went missing (DEV-1490).
  it.each([
    ["PGRST205", "Could not find the table in the schema cache"],
    ["42703", "column curated_products.image_width does not exist"],
  ])(
    "throws rather than degrading to [] when the schema lags (%s)",
    async (code, message) => {
      const { client } = stubClient({ error: { code, message } });

      await expect(
        getPublishedCuratedProductsForHomepage(client),
      ).rejects.toBeInstanceOf(CuratedProductSchemaLagError);
    },
  );

  it("names the offending code in the schema-lag message", async () => {
    const { client } = stubClient({
      error: {
        code: "42703",
        message: "column curated_products.image_width does not exist",
      },
    });

    await expect(
      getPublishedCuratedProductsForHomepage(client),
    ).rejects.toThrow(/42703.*image_width/);
  });
});

const BRAND_ID = "3f8b6d2a-5c14-4e79-9a03-77b1e6c2d904";
const PRODUCT_ID = "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20";

type WriteReply = {
  data?: unknown;
  error?: { code?: string; message: string } | null;
};

type WriteCalls = {
  table: string[];
  insert: Record<string, unknown>[];
  update: Record<string, unknown>[];
  upsert: Record<string, unknown>[];
  eq: [string, unknown][];
  in: [string, unknown[]][];
  neq: [string, unknown][];
};

/**
 * Writer-side sibling of `stubClient`: the writers take the same
 * `Pick<SupabaseClient, "from">` seam, and `scripts/check-test-boundaries.mjs`
 * forbids `vi.mock` of `@/lib/services/` and `@/lib/supabase/`, so injecting the
 * client is the only way to observe a payload.
 *
 * Each terminal await consumes the next queued reply, so a writer that retries
 * (the key-collision loop) can be handed a 23505 followed by a success.
 *
 * Ceiling: it replays canned replies and never evaluates a filter. Anything
 * that depends on a real constraint firing belongs in the integration file.
 */
function stubWriteClient(replies: WriteReply[]): {
  client: CuratedProductSupabase;
  calls: WriteCalls;
} {
  const calls: WriteCalls = {
    table: [],
    insert: [],
    update: [],
    upsert: [],
    eq: [],
    in: [],
    neq: [],
  };
  const queue = [...replies];

  const nextReply = () => {
    const reply = queue.shift() ?? {};
    return { data: reply.data ?? null, error: reply.error ?? null };
  };

  const chain = {
    select() {
      return chain;
    },
    insert(payload: Record<string, unknown>) {
      calls.insert.push(payload);
      return chain;
    },
    update(payload: Record<string, unknown>) {
      calls.update.push(payload);
      return chain;
    },
    upsert(payload: Record<string, unknown>) {
      calls.upsert.push(payload);
      return chain;
    },
    eq(column: string, value: unknown) {
      calls.eq.push([column, value]);
      return chain;
    },
    in(column: string, values: unknown[]) {
      calls.in.push([column, values]);
      return chain;
    },
    neq(column: string, value: unknown) {
      calls.neq.push([column, value]);
      return chain;
    },
    single() {
      return Promise.resolve(nextReply());
    },
    maybeSingle() {
      return Promise.resolve(nextReply());
    },
    then<TResult>(
      resolve: (value: ReturnType<typeof nextReply>) => TResult,
      reject?: (reason: unknown) => TResult,
    ) {
      return Promise.resolve(nextReply()).then(resolve, reject);
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

describe("curatedProductPromoteBlockers", () => {
  const promotable = {
    lifecycle: "candidate",
    officialUrl: "https://example.com/pick",
    sourceCheckedAt: "2026-08-13T00:00:00Z",
  };

  it("returns no blockers when all four conditions hold", () => {
    expect(
      curatedProductPromoteBlockers(promotable, [{ state: "active" }]),
    ).toEqual([]);
  });

  it("names official_url when it is null", () => {
    expect(
      curatedProductPromoteBlockers({ ...promotable, officialUrl: null }, [
        { state: "active" },
      ]),
    ).toContain("official_url");
  });

  it("names source_checked_at when it is null", () => {
    expect(
      curatedProductPromoteBlockers({ ...promotable, sourceCheckedAt: null }, [
        { state: "active" },
      ]),
    ).toContain("source_checked_at");
  });

  it("names no_active_source when every source row is retired", () => {
    // Retire-never-delete: the row survives withdrawal, so its presence is not
    // evidence. Only an active row is.
    expect(
      curatedProductPromoteBlockers(promotable, [{ state: "retired" }]),
    ).toContain("no_active_source");
  });

  it("names lifecycle for a product that is already published or retired", () => {
    expect(
      curatedProductPromoteBlockers({ ...promotable, lifecycle: "retired" }, [
        { state: "active" },
      ]),
    ).toContain("lifecycle");
    expect(
      curatedProductPromoteBlockers({ ...promotable, lifecycle: "published" }, [
        { state: "active" },
      ]),
    ).toContain("lifecycle");
  });

  it("promotes from needs_review as well as candidate", () => {
    expect(
      curatedProductPromoteBlockers(
        { ...promotable, lifecycle: "needs_review" },
        [{ state: "active" }],
      ),
    ).toEqual([]);
  });

  it("ignores link_state, which is deliberately not a promote condition", () => {
    // A broken link suppresses the call-to-action; it does not block the
    // editorial decision, and the predicate is not even given the field.
    expect(
      curatedProductPromoteBlockers(promotable, [{ state: "active" }]),
    ).toEqual([]);
  });
});

describe("createCuratedProduct", () => {
  it("create_derives_key_from_cjk_name — a Chinese-only name yields a kebab-case key", async () => {
    // `generateSlug` transliterates Han via pinyin; the brand-slug helper
    // `slugifyRomanizedName` would strip every codepoint and return "".
    const { client, calls } = stubWriteClient([
      { data: { id: "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20", key: "ignored" } },
    ]);

    await createCuratedProduct(
      { brandId: BRAND_ID, nameZh: "陶瓷茶杯", l1: "home" },
      client,
    );

    const key = calls.insert.at(0)?.key as string;
    expect(key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("create_writes_candidate_lifecycle — lifecycle and proposed_by are set by the writer, not the caller", async () => {
    const { client, calls } = stubWriteClient([
      { data: { id: "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20", key: "teacup" } },
    ]);

    // A caller-supplied lifecycle has no route into the payload: the input type
    // has no such field, so the cast is the only way to smuggle one in.
    const smuggled = {
      brandId: BRAND_ID,
      nameZh: "Teacup",
      l1: "home",
      lifecycle: "published",
    } as unknown as Parameters<typeof createCuratedProduct>[0];

    await createCuratedProduct(smuggled, client);

    const payload = calls.insert.at(0);
    expect(payload?.lifecycle).toBe("candidate");
    expect(payload?.proposed_by).toBe("admin");
    expect(calls.table).toEqual(["curated_products"]);
  });

  it("create_suffixes_key_on_collision — a unique violation retries with a suffixed key", async () => {
    const { client, calls } = stubWriteClient([
      { error: { code: "23505", message: "duplicate key value" } },
      { data: { id: "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20", key: "teacup-2" } },
    ]);

    const created = await createCuratedProduct(
      { brandId: BRAND_ID, nameZh: "Teacup", l1: "home" },
      client,
    );

    expect(calls.insert.map((payload) => payload.key)).toEqual([
      "teacup",
      "teacup-2",
    ]);
    expect(created.key).toBe("teacup-2");
  });

  it("keeps only L2 subcategories that belong to the given L1", async () => {
    const { client, calls } = stubWriteClient([
      { data: { id: "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20", key: "teacup" } },
    ]);

    await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh: "Teacup",
        l1: "home",
        // A slug, a Chinese label, and a subcategory from another branch.
        l2: ["tableware", "餐具", "kids-tableware"],
      },
      client,
    );

    expect(calls.insert.at(0)?.l2).toEqual(["tableware"]);
  });

  it("createCuratedProduct writes the highlight fields", async () => {
    const { client, calls } = stubWriteClient([
      { data: { id: PRODUCT_ID, key: "teacup" } },
    ]);

    await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh: "Teacup",
        l1: "home",
        highlightPosition: 2,
        highlightRationaleZh: "品牌頁亮點",
        highlightRationaleEn: "Brand-page highlight",
      },
      client,
    );

    expect(calls.insert.at(0)).toMatchObject({
      highlight_position: 2,
      highlight_rationale_zh: "品牌頁亮點",
      highlight_rationale_en: "Brand-page highlight",
    });
  });
});

describe("curated product writers", () => {
  it("upserts a trail selection on its composite key without highlight fields", async () => {
    const { client, calls } = stubWriteClient([
      { data: { brand_id: BRAND_ID } },
      { data: [] },
      {},
    ]);

    await upsertCuratedProductSelection(
      {
        productId: PRODUCT_ID,
        trailSlug: "small-space-reading-corner",
        sectionKey: "light-first",
        position: 2,
        rationaleZh: "在桌面上保留閱讀的餘裕。",
        rationaleEn: "Keeps room for reading on the desk.",
      },
      client,
    );

    expect(calls.table).toContain("curated_product_selections");
    expect(calls.upsert.at(0)).toEqual({
      product_id: PRODUCT_ID,
      trail_slug: "small-space-reading-corner",
      section_key: "light-first",
      position: 2,
      rationale_zh: "在桌面上保留閱讀的餘裕。",
      rationale_en: "Keeps room for reading on the desk.",
      state: "active",
    });
    expect(Object.keys(calls.upsert.at(0) ?? {})).not.toContain("highlight_position");
  });

  it("rejects a second product from the same brand in the same trail section", async () => {
    const { client, calls } = stubWriteClient([
      { data: { brand_id: BRAND_ID } },
      {
        data: [
          {
            product_id: "conflicting-product",
            curated_products: { brand_id: BRAND_ID, key: "already-picked" },
          },
        ],
      },
    ]);

    await expect(
      upsertCuratedProductSelection(
        {
          productId: PRODUCT_ID,
          trailSlug: "small-space-reading-corner",
          sectionKey: "light-first",
          rationaleZh: "同一段落的第二個品牌產品",
        },
        client,
      ),
    ).rejects.toThrow("already-picked");
    expect(calls.upsert).toHaveLength(0);
  });

  it("allows the same brand in two different sections of one trail", async () => {
    const { client, calls } = stubWriteClient([
      { data: { brand_id: BRAND_ID } },
      { data: [] },
      {},
      { data: { brand_id: BRAND_ID } },
      { data: [] },
      {},
    ]);

    await upsertCuratedProductSelection(
      {
        productId: PRODUCT_ID,
        trailSlug: "small-space-reading-corner",
        sectionKey: "light-first",
        rationaleZh: "另一段落的同品牌產品",
      },
      client,
    );
    await upsertCuratedProductSelection(
      {
        productId: PRODUCT_ID,
        trailSlug: "small-space-reading-corner",
        sectionKey: "beside-seat",
        rationaleZh: "同品牌在另一段落的產品",
      },
      client,
    );

    expect(calls.upsert).toHaveLength(2);
    expect(calls.upsert.map((payload) => payload.section_key)).toEqual([
      "light-first",
      "beside-seat",
    ]);
  });

  it("allows re-upserting the same product into its own section", async () => {
    const { client, calls } = stubWriteClient([
      { data: { brand_id: BRAND_ID } },
      { data: [] },
      {},
    ]);

    await upsertCuratedProductSelection(
      {
        productId: PRODUCT_ID,
        trailSlug: "small-space-reading-corner",
        sectionKey: "light-first",
        rationaleZh: "重新編輯同一個選物",
      },
      client,
    );

    expect(calls.neq).toContainEqual(["product_id", PRODUCT_ID]);
    expect(calls.upsert).toHaveLength(1);
  });

  it("retires a trail selection without deleting it", async () => {
    const { client, calls } = stubWriteClient([{ data: [{ product_id: PRODUCT_ID }] }]);

    await retireCuratedProductSelection(
      {
        productId: PRODUCT_ID,
        trailSlug: "small-space-reading-corner",
        sectionKey: "light-first",
      },
      client,
    );

    expect(calls.update.at(0)).toEqual({ state: "retired" });
    expect(calls.table).toContain("curated_product_selections");
  });

  it("fails when the requested trail placement does not exist", async () => {
    const { client, calls } = stubWriteClient([{ data: [] }]);

    await expect(
      retireCuratedProductSelection(
        {
          productId: PRODUCT_ID,
          trailSlug: "small-space-reading-corner",
          sectionKey: "light-first",
        },
        client,
      ),
    ).rejects.toThrow("Curated product selection not found");
    expect(calls.update.at(0)).toEqual({ state: "retired" });
  });

  it("update_never_writes_link_state — link health is owned by the link checker", async () => {
    const { client, calls } = stubWriteClient([{}]);

    await updateCuratedProduct(
      "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20",
      { nameZh: "Renamed", officialUrl: "https://example.com/renamed" },
      client,
    );

    const payload = calls.update.at(0) ?? {};
    expect(Object.keys(payload)).not.toContain("link_state");
    expect(Object.keys(payload)).not.toContain("link_checked_at");
    expect(Object.keys(payload)).not.toContain("lifecycle");
    expect(payload.name_zh).toBe("Renamed");
  });

  it("update_clears_a_field_sent_as_null_and_skips_an_absent_one", async () => {
    // Absent and null are different instructions: absent leaves the column
    // alone, null empties it. Collapsing them leaves no payload that can ever
    // clear a value the editor filled in by mistake.
    const { client, calls } = stubWriteClient([{}]);

    await updateCuratedProduct(
      "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20",
      { officialUrl: null, notesZh: null },
      client,
    );

    const payload = calls.update.at(0) ?? {};
    expect(payload.official_url).toBeNull();
    expect(payload.notes_zh).toBeNull();
    expect(Object.keys(payload)).not.toContain("name_zh");
    expect(Object.keys(payload)).not.toContain("notes_en");
  });

  it("updateCuratedProduct clears a highlight field sent as null and skips an absent one", async () => {
    const { client, calls } = stubWriteClient([{}]);

    await updateCuratedProduct(
      PRODUCT_ID,
      { highlightPosition: null, highlightRationaleZh: null },
      client,
    );

    const payload = calls.update.at(0) ?? {};
    expect(payload.highlight_position).toBeNull();
    expect(payload.highlight_rationale_zh).toBeNull();
    expect(Object.keys(payload)).not.toContain("highlight_rationale_en");
  });

  it("retires a product by flipping lifecycle, never by deleting", async () => {
    const { client, calls } = stubWriteClient([{}]);

    await retireCuratedProduct("6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20", client);

    expect(calls.table).toEqual(["curated_products"]);
    expect(calls.update.at(0)).toEqual({ lifecycle: "retired" });
  });

  it("retires a source by flipping state, never by deleting", async () => {
    const { client, calls } = stubWriteClient([{}]);

    await retireCuratedProductSource(
      "9c2e7a51-3b06-4d88-a1f4-2e5c8b0d6417",
      client,
    );

    expect(calls.table).toEqual(["curated_product_sources"]);
    expect(calls.update.at(0)).toEqual({ state: "retired" });
  });

  it("writers_throw_on_missing_table — PGRST205 is rethrown, unlike the read", async () => {
    // The read swallows PGRST205 so a brand page degrades to "no curated
    // section" during the deploy/migration window. A writer that swallowed it
    // would report success while writing nothing.
    const missingTable = {
      code: "PGRST205",
      message:
        "Could not find the table 'public.curated_products' in the schema cache",
    };

    await expect(
      createCuratedProduct(
        { brandId: BRAND_ID, nameZh: "Teacup", l1: "home" },
        stubWriteClient([{ error: missingTable }]).client,
      ),
    ).rejects.toMatchObject({ code: "PGRST205" });

    await expect(
      updateCuratedProduct(
        "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20",
        { nameZh: "Renamed" },
        stubWriteClient([{ error: missingTable }]).client,
      ),
    ).rejects.toMatchObject({ code: "PGRST205" });

    await expect(
      retireCuratedProduct(
        "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20",
        stubWriteClient([{ error: missingTable }]).client,
      ),
    ).rejects.toMatchObject({ code: "PGRST205" });

    await expect(
      retireCuratedProductSource(
        "9c2e7a51-3b06-4d88-a1f4-2e5c8b0d6417",
        stubWriteClient([{ error: missingTable }]).client,
      ),
    ).rejects.toMatchObject({ code: "PGRST205" });
  });
});

describe("promoteCuratedProduct", () => {
  const gateRow = {
    lifecycle: "candidate",
    official_url: "https://example.com/pick",
    source_checked_at: "2026-08-13T00:00:00Z",
    curated_product_sources: [{ state: "active" }],
  };

  it("re-asserts the lifecycle in the UPDATE, not only in the read", async () => {
    // The read proved the lifecycle a moment ago, which is not the same as
    // proving it now. Without the filter, a retire landing between the two is
    // silently overwritten and the product republishes itself.
    const { client, calls } = stubWriteClient([
      { data: gateRow },
      { data: [{ id: PRODUCT_ID }] },
    ]);

    const outcome = await promoteCuratedProduct(PRODUCT_ID, client);

    expect(outcome).toEqual({ ok: true });
    expect(calls.update.at(0)).toEqual({ lifecycle: "published" });
    expect(calls.in).toContainEqual([
      "lifecycle",
      ["candidate", "needs_review"],
    ]);
  });

  it("treats a zero-row update as a lifecycle refusal, not a success", async () => {
    // What a concurrent retire looks like from here: the gate passed, the
    // UPDATE matched nothing.
    const { client } = stubWriteClient([{ data: gateRow }, { data: [] }]);

    const outcome = await promoteCuratedProduct(PRODUCT_ID, client);

    expect(outcome).toMatchObject({ ok: false, blockers: ["lifecycle"] });
  });

  it("refuses before the update when the gate itself fails", async () => {
    const { client, calls } = stubWriteClient([
      { data: { ...gateRow, curated_product_sources: [{ state: "retired" }] } },
    ]);

    const outcome = await promoteCuratedProduct(PRODUCT_ID, client);

    expect(outcome).toMatchObject({
      ok: false,
      blockers: ["no_active_source"],
    });
    expect(calls.update).toEqual([]);
  });
});

describe("getCuratedProductWriteContext", () => {
  it("reads brand, image and lifecycle from the ROW, never from a caller", async () => {
    // A server action is a POST endpoint: a caller-supplied brandId files an
    // upload under another brand's storage prefix, and a caller-supplied
    // previous image URL is a delete primitive over that prefix.
    const { client, calls } = stubWriteClient([
      {
        data: {
          brand_id: BRAND_ID,
          image_url: "https://cdn.example.com/stored.webp",
          image_source_url: "https://example.com/source.png",
          lifecycle: "published",
          brands: { slug: "studio-kiln" },
        },
      },
    ]);

    const context = await getCuratedProductWriteContext(PRODUCT_ID, client);

    expect(context).toEqual({
      brandId: BRAND_ID,
      brandSlug: "studio-kiln",
      imageUrl: "https://cdn.example.com/stored.webp",
      imageSourceUrl: "https://example.com/source.png",
      lifecycle: "published",
    });
    expect(calls.eq).toContainEqual(["id", PRODUCT_ID]);
  });

  it("returns null for a product that no longer exists", async () => {
    const { client } = stubWriteClient([{ data: null }]);
    await expect(
      getCuratedProductWriteContext(PRODUCT_ID, client),
    ).resolves.toBeNull();
  });
});

describe("listCuratedProductsForAdmin", () => {
  /**
   * The drawer's placement panel reads its prefill from `selections`, and its
   * Section dropdown unions these keys with the trail's MDX so an orphaned
   * placement stays retirable (DEV-1487). Retired rows are history: prefilling
   * from one would re-place a selection an editor deliberately withdrew.
   */
  it("returns only the active selections, mapped to camelCase", async () => {
    const { client } = stubClient({
      data: [
        productRow({
          brands: { slug: "studio-kiln", name: "Studio Kiln" },
          proposed_by: "admin",
          updated_at: "2026-08-16T00:00:00Z",
          curated_product_sources: [],
          curated_product_selections: [
            {
              trail_slug: "small-space-reading-corner",
              section_key: "desk-companions",
              position: 2,
              rationale_zh: "還在 MDX 之外",
              rationale_en: null,
              state: "active",
            },
            {
              trail_slug: "small-space-reading-corner",
              section_key: "withdrawn",
              position: 0,
              rationale_zh: "已撤下",
              rationale_en: null,
              state: "retired",
            },
          ],
        }),
      ],
    });

    const [product] = await listCuratedProductsForAdmin(client);

    expect(product?.selections).toEqual([
      {
        trailSlug: "small-space-reading-corner",
        sectionKey: "desk-companions",
        position: 2,
        rationaleZh: "還在 MDX 之外",
        rationaleEn: null,
      },
    ]);
  });
});
