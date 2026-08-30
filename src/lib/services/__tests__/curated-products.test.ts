import { describe, expect, it } from "vitest";
import {
  createCuratedProduct,
  CuratedProductSchemaLagError,
  getBrandTrailSlugs,
  getCuratedProductsByBrandBatch,
  getCuratedProductWriteContext,
  getPublishedCuratedProductsForHomepage,
  getPublishedCuratedProductsForBrand,
  getPublishedCuratedProductsForTrail,
  listCuratedProductsForAdmin,
  retireCuratedProductSelection,
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
function stubClient(result: QueryResult | QueryResult[]): {
  client: CuratedProductSupabase;
  calls: RecordedCalls;
} {
  const results = Array.isArray(result) ? [...result] : [result];
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
      const next = results.length > 1 ? results.shift()! : results[0]!;
      return Promise.resolve({
        data: next.data ?? null,
        error: next.error ?? null,
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
    category: "home",
    subcategory: "tableware",
    official_url: "https://example.com/pick",
    image_url: null,
    image_source_url: null,
    visible: true,
    link_state: "ok",
    link_checked_at: null,
    source_checked_at: "2026-08-13T00:00:00Z",
    review_due_at: null,
    product_description_zh: "一支手感穩定的產品。",
    product_description_en: null,
    product_position: null,
    created_at: "2026-08-13T00:00:00Z",
    curated_product_selections: [],
    ...overrides,
  };
}

function trailProductRow(overrides: Record<string, unknown> = {}) {
  return productRow({
    brands: {
      slug: "fixture-brand",
      name: "Fixture Brand",
      status: "approved",
    },
    curated_product_selections: [
      {
        trail_slug: "small-space-reading-corner",
        section_key: "first",
        position: 1,
        state: "active",
      },
    ],
    ...overrides,
  });
}

describe("getPublishedCuratedProductsForTrail", () => {
  it("keeps the four-condition publication gate and trail filters", async () => {
    const { client, calls } = stubClient({ data: [] });

    await getPublishedCuratedProductsForTrail(
      "small-space-reading-corner",
      client,
    );

    expect(calls.eq).toContainEqual(["visible", true]);
    expect(calls.not).toContainEqual(["official_url", "is", null]);
    expect(calls.not).toContainEqual(["source_checked_at", "is", null]);
    expect(calls.eq).toContainEqual([
      "curated_product_sources.state",
      "active",
    ]);
    expect(calls.eq).toContainEqual([
      "curated_product_selections.state",
      "active",
    ]);
    expect(calls.eq).toContainEqual([
      "curated_product_selections.trail_slug",
      "small-space-reading-corner",
    ]);
  });

  // Same reasoning as the homepage rail: a trail page turns this read into its
  // whole product body, so degrading to `[]` during the deploy->migrate window
  // caches an empty trail with a green build and nothing in Sentry.
  it.each([
    [
      "PGRST205",
      "Could not find the table 'public.curated_product_selections' in the schema cache",
    ],
    ["42703", "column curated_products.visible does not exist"],
  ])(
    "throws CuratedProductSchemaLagError rather than degrading to [] when the schema lags (%s)",
    async (code, message) => {
      const { client } = stubClient({
        error: { code, message },
      });

      await expect(
        getPublishedCuratedProductsForTrail(
          "small-space-reading-corner",
          client,
        ),
      ).rejects.toBeInstanceOf(CuratedProductSchemaLagError);
    },
  );

  it("rethrows any other trail-read error untouched", async () => {
    const { client } = stubClient({
      error: { code: "42501", message: "permission denied" },
    });

    await expect(
      getPublishedCuratedProductsForTrail("small-space-reading-corner", client),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("does not cap products per brand", async () => {
    const { client } = stubClient({
      data: [
        trailProductRow({ key: "first" }),
        trailProductRow({ key: "second" }),
        trailProductRow({ key: "third" }),
      ],
    });

    const products = await getPublishedCuratedProductsForTrail(
      "small-space-reading-corner",
      client,
    );

    expect(products).toHaveLength(3);
    expect(
      products.every((product) => product.brandSlug === "fixture-brand"),
    ).toBe(true);
  });

  it("renders the trail read from product_description", async () => {
    const { client, calls } = stubClient({
      data: [
        trailProductRow({
          product_description_zh: "一盞放在桌角也不擠的燈。",
          product_description_en: "A lamp that fits the corner of a desk.",
        }),
      ],
    });

    const [product] = await getPublishedCuratedProductsForTrail(
      "small-space-reading-corner",
      client,
    );

    expect(product?.productDescriptionZh).toBe("一盞放在桌角也不擠的燈。");
    expect(product?.productDescriptionEn).toBe(
      "A lamp that fits the corner of a desk.",
    );
    // The dropped column must not come back through the select list: a
    // selection-scoped rationale is what this ticket collapsed away.
    expect(calls.select.at(0)).not.toContain("rationale_zh");
    expect(calls.select.at(0)).toContain("product_description_zh");
  });

  it("excludes retired selections", async () => {
    const { client } = stubClient({
      data: [
        trailProductRow({
          curated_product_selections: [
            {
              trail_slug: "small-space-reading-corner",
              section_key: "first",
              position: 1,
              state: "retired",
            },
          ],
        }),
      ],
    });

    await expect(
      getPublishedCuratedProductsForTrail("small-space-reading-corner", client),
    ).resolves.toEqual([]);
  });

  it("orders equal-position selections deterministically by product key", async () => {
    const { client } = stubClient({
      data: [
        trailProductRow({ key: "zeta" }),
        trailProductRow({ key: "alpha" }),
      ],
    });

    const products = await getPublishedCuratedProductsForTrail(
      "small-space-reading-corner",
      client,
    );

    expect(products.map((product) => product.key)).toEqual(["alpha", "zeta"]);
  });
});

describe("legacy product L2 reads", () => {
  it("retries only the missing scalar column and drops ambiguous public rows", async () => {
    // Catches a rolling deploy either blanking the brand section or exposing an ambiguous product.
    const { subcategory: _subcategory, ...legacySingleton } = productRow();
    const { subcategory: _ignored, ...legacyAmbiguous } = productRow({
      id: "33333333-3333-3333-3333-333333333333",
      key: "ambiguous",
    });
    const { client, calls } = stubClient([
      {
        error: {
          code: "42703",
          message: "column curated_products.subcategory does not exist",
        },
      },
      {
        data: [
          { ...legacySingleton, subcategories: ["tableware"] },
          {
            ...legacyAmbiguous,
            subcategories: ["tableware", "candles"],
          },
        ],
      },
    ]);

    const products = await getPublishedCuratedProductsForBrand(
      "22222222-2222-2222-2222-222222222222",
      client,
    );

    expect(products.map((product) => product.key)).toEqual(["pick"]);
    expect(products[0]?.subcategory).toBe("tableware");
    expect(calls.select).toHaveLength(2);
    expect(calls.select[0]).toContain("subcategory");
    expect(calls.select[1]).toContain("subcategories");
  });

  it("keeps an ambiguous legacy row repairable in the admin queue", async () => {
    // Catches compatibility code hiding the exact rows the Needs L2 tab must repair.
    const { subcategory: _subcategory, ...legacy } = productRow({
      brands: { slug: "studio-kiln", name: "Studio Kiln" },
      proposed_by: "admin",
      updated_at: "2026-08-16T00:00:00Z",
      curated_product_sources: [],
    });
    const { client } = stubClient([
      {
        error: {
          code: "PGRST204",
          message: "Could not find the 'subcategory' column",
        },
      },
      { data: [{ ...legacy, subcategories: ["tableware", "candles"] }] },
    ]);

    const products = await listCuratedProductsForAdmin(client);

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ key: "pick", subcategory: null });
  });
});

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
    expect(calls.eq).toContainEqual(["visible", true]);
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

  it("returns [] when the product-description columns are not in the database yet", async () => {
    // The column probe against staging returned Postgres 42703. This deploy
    // window is distinct from PGRST205 (the table itself is already present).
    const { client } = stubClient({
      error: {
        code: "42703",
        message:
          "column curated_products.product_description_zh does not exist",
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

  it("maps product_description_zh onto the brand read", async () => {
    const { client, calls } = stubClient({
      data: [
        productRow({
          product_description_zh: "杯口薄、杯身厚，熱飲不燙手。",
          product_description_en: "Thin at the lip, thick in the body.",
        }),
      ],
    });

    const [product] = await getPublishedCuratedProductsForBrand(
      "brand-1",
      client,
    );

    expect(product?.productDescriptionZh).toBe("杯口薄、杯身厚，熱飲不燙手。");
    expect(product?.productDescriptionEn).toBe(
      "Thin at the lip, thick in the body.",
    );
    // One text field, not three. The collapsed names must not survive anywhere
    // on the mapped object — a leftover key would keep a dead surface alive.
    for (const dead of [
      "rationaleZh",
      "rationaleEn",
      "notesZh",
      "notesEn",
      "highlightPosition",
      "highlightRationaleZh",
      "highlightRationaleEn",
    ]) {
      expect(Object.keys(product ?? {})).not.toContain(dead);
    }
    expect(calls.select.at(0)).not.toContain("rationale_zh");
    expect(calls.select.at(0)).not.toContain("notes_zh");
  });

  it("orders the brand page by product_position then createdAt then key", async () => {
    const { client } = stubClient({
      data: [
        productRow({
          key: "unpositioned-newer",
          product_position: null,
          created_at: "2026-08-15T00:00:00Z",
        }),
        productRow({
          key: "zeta",
          product_position: null,
          created_at: "2026-08-14T00:00:00Z",
        }),
        productRow({
          key: "alpha",
          product_position: null,
          created_at: "2026-08-14T00:00:00Z",
        }),
        productRow({ key: "positioned", product_position: 1 }),
      ],
    });

    const products = await getPublishedCuratedProductsForBrand(
      "brand-1",
      client,
    );

    expect(products.map((product) => product.key)).toEqual([
      "positioned",
      "alpha",
      "zeta",
      "unpositioned-newer",
    ]);
  });

  it("keeps a product whose selections are all retired", async () => {
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
    expect(unplaced?.trailSlug).toBeNull();
    // Placement is presentation, never proof: the description survives it.
    expect(unplaced?.productDescriptionZh).toBeTruthy();
  });

  it("keeps the winning selection lowest-position-first, tied by trail slug", async () => {
    const { client } = stubClient({
      data: [
        productRow({
          curated_product_selections: [
            { trail_slug: "zesty", section_key: "picks", position: 1 },
            { trail_slug: "artisan", section_key: "picks", position: 1 },
            { trail_slug: "everyday", section_key: "picks", position: 5 },
          ],
        }),
      ],
    });

    const [product] = await getPublishedCuratedProductsForBrand(
      "brand-1",
      client,
    );

    expect(product?.trailSlug).toBe("artisan");
    expect(product?.position).toBe(1);
  });
});

function homepageRow(overrides: Record<string, unknown> = {}) {
  return productRow({
    image_url: "https://images.example.com/selected-product.webp",
    curated_product_sources: [{ id: "source-1", state: "active" }],
    curated_product_selections: [
      {
        trail_slug: "picks",
        section_key: "home",
        position: 1,
        state: "active",
      },
    ],
    brands: {
      slug: "warmwood",
      name: "Warmwood",
      status: "approved",
    },
    ...overrides,
  });
}

describe("getPublishedCuratedProductsForHomepage", () => {
  it("homepage eligibility filters on visible", async () => {
    const { client } = stubClient({
      data: [
        homepageRow({ key: "live" }),
        homepageRow({
          key: "hidden",
          visible: false,
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

  it("drops a homepage product whose brand is not approved", async () => {
    // Everything except the brand status is held constant, so a pass here is a
    // statement about the brand gate rather than about the fixture.
    const { client } = stubClient({
      data: [
        homepageRow({ key: "approved" }),
        homepageRow({
          key: "pending",
          brands: { slug: "pending", name: "Pending", status: "pending" },
        }),
      ],
    });

    const products = await getPublishedCuratedProductsForHomepage(client);

    expect(products.map((product) => product.key)).toEqual(["approved"]);
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

  it("keeps a homepage product that has no trail placement", async () => {
    // A trail placement is presentation, not a publication condition: the wall
    // renders a published product on its own description alone.
    const { client, calls } = stubClient({
      data: [
        homepageRow({
          key: "unplaced",
          curated_product_selections: [],
          product_description_zh: "品牌頁也值得被看見。",
        }),
      ],
    });

    const [product] = await getPublishedCuratedProductsForHomepage(client);

    expect(product?.key).toBe("unplaced");
    expect(product?.productDescriptionZh).toBe("品牌頁也值得被看見。");
    expect(product?.trailSlug).toBeNull();
    // The embed stays NON-inner, so a product with zero selections survives it.
    expect(calls.select[0]).not.toContain("curated_product_selections!inner");
    expect(calls.select[0]).toContain(
      "curated_product_selections(trail_slug, section_key, position)",
    );
  });

  // The read deliberately carries the whole published set: the per-brand cap
  // lives in the wall composer, AFTER the daily shuffle. Capping here would
  // freeze which two of a brand's products the shuffle can ever choose from.
  it("returns every published product of a brand, uncapped", async () => {
    const { client } = stubClient({
      data: [
        homepageRow({ key: "first", brand_id: "brand-1" }),
        homepageRow({ key: "second", brand_id: "brand-1" }),
        homepageRow({ key: "third", brand_id: "brand-1" }),
        homepageRow({
          key: "other-brand",
          brand_id: "brand-2",
          brands: {
            slug: "other-brand",
            name: "Other Brand",
            status: "approved",
          },
        }),
      ],
    });

    const products = await getPublishedCuratedProductsForHomepage(client);

    expect(
      products.filter((product) => product.brandId === "brand-1"),
    ).toHaveLength(3);
    expect(products.map((product) => product.key)).toContain("other-brand");
  });

  it("image_usage no longer filters — permission is an outreach errand, not a column", async () => {
    // The column is gone. A row that the old `.in("image_usage", …)` gate would
    // have dropped for `none` now renders like any other visible product.
    const { client, calls } = stubClient({
      data: [
        homepageRow({ key: "licensed", image_usage: "licensed" }),
        homepageRow({ key: "none", image_usage: "none" }),
      ],
    });

    const products = await getPublishedCuratedProductsForHomepage(client);

    expect(products.map((product) => product.key)).toEqual([
      "licensed",
      "none",
    ]);
    expect(calls.in.map(([column]) => column)).not.toContain("image_usage");
    expect(calls.select.at(0)).not.toContain("image_usage");
  });

  it("homepage products sort by brandSlug then key", async () => {
    // Two keys, in that order, and nothing before them: no column pins a
    // product to a wall slot any more, so the composer receives a stable list
    // it is free to shuffle whole.
    const rows = [
      homepageRow({
        key: "brand-beta",
        brand_id: "brand-beta",
        brands: { slug: "brand-beta", name: "Beta", status: "approved" },
      }),
      homepageRow({
        key: "zeta",
        brand_id: "brand-alpha",
        brands: { slug: "alpha", name: "Alpha", status: "approved" },
      }),
      homepageRow({
        key: "alpha",
        brand_id: "brand-alpha",
        brands: { slug: "alpha", name: "Alpha", status: "approved" },
      }),
      homepageRow({
        key: "later",
        brand_id: "brand-later",
        brands: { slug: "later", name: "Later", status: "approved" },
        curated_product_selections: [],
      }),
      homepageRow({
        key: "unplaced",
        brand_id: "brand-unplaced",
        brands: { slug: "unplaced", name: "Unplaced", status: "approved" },
        curated_product_selections: [],
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
    expect(first.calls.select[0]).not.toContain(
      "curated_product_selections!inner",
    );
    // The select list asks for the CURRENT text column and for none of the
    // three it replaced — a stale name here is a schema-lag 42703 in prod.
    expect(first.calls.select[0]).toContain("product_description_zh");
    expect(first.calls.select[0]).not.toContain("rationale_zh");
    expect(first.calls.select[0]).not.toContain("notes_zh");
    expect(first.calls.select[0]).not.toContain("wall_position");
    expect(first.calls.select[0]).not.toContain("lifecycle");
  });

  it("publishes image-less products while keeping the other publication gates", async () => {
    const { client } = stubClient({
      data: [
        homepageRow({ key: "live" }),
        homepageRow({ key: "hidden", visible: false }),
        homepageRow({ key: "no-url", official_url: null }),
        homepageRow({ key: "unchecked", source_checked_at: null }),
        homepageRow({ key: "no-image", image_url: null }),
        homepageRow({
          key: "no-active-source",
          curated_product_sources: [{ id: "s", state: "retired" }],
        }),
      ],
    });

    const products = await getPublishedCuratedProductsForHomepage(client);

    expect(products.map((product) => product.key)).toEqual([
      "live",
      "no-image",
    ]);
  });

  // A missing table or column means the schema is older than this code, which
  // for the homepage is NOT the same as "nothing is published". `[]` would drop
  // the whole selection zone from a `●` prerender and cache it for an hour with
  // a green build and nothing in Sentry — how the wall went missing (DEV-1490).
  it.each([
    ["PGRST205", "Could not find the table in the schema cache"],
    ["42703", "column curated_products.product_description_zh does not exist"],
  ])(
    "throws CuratedProductSchemaLagError rather than degrading to [] when the schema lags (%s)",
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
        message:
          "column curated_products.product_description_zh does not exist",
      },
    });

    await expect(
      getPublishedCuratedProductsForHomepage(client),
    ).rejects.toThrow(/42703.*product_description_zh/);
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

describe("createCuratedProduct", () => {
  it("create_derives_key_from_cjk_name — a Chinese-only name yields a kebab-case key", async () => {
    // `generateSlug` transliterates Han via pinyin; the brand-slug helper
    // `slugifyRomanizedName` would strip every codepoint and return "".
    const { client, calls } = stubWriteClient([
      { data: { id: "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20", key: "ignored" } },
    ]);

    await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh: "陶瓷茶杯",
        category: "home",
        productDescriptionZh: "陶土燒製，容量約 200 毫升。",
      },
      client,
    );

    const key = calls.insert.at(0)?.key as string;
    expect(key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("create_defaults_to_hidden — visible and proposed_by are set by the writer, not the caller", async () => {
    const { client, calls } = stubWriteClient([
      { data: { id: "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20", key: "teacup" } },
    ]);

    // The three dropped columns have no route into the payload: the input type
    // has no such fields, so the cast is the only way to smuggle them in.
    const smuggled = {
      brandId: BRAND_ID,
      nameZh: "Teacup",
      category: "home",
      productDescriptionZh: "陶土燒製，容量約 200 毫升。",
      lifecycle: "published",
      wallPosition: 3,
      imageUsage: "licensed",
    } as unknown as Parameters<typeof createCuratedProduct>[0];

    await createCuratedProduct(smuggled, client);

    const payload = calls.insert.at(0) ?? {};
    expect(payload.visible).toBe(false);
    expect(payload.proposed_by).toBe("admin");
    expect(Object.keys(payload)).not.toContain("lifecycle");
    expect(Object.keys(payload)).not.toContain("wall_position");
    expect(Object.keys(payload)).not.toContain("image_usage");
    expect(calls.table).toEqual(["curated_products"]);
  });

  it("create_suffixes_key_on_collision — a unique violation retries with a suffixed key", async () => {
    const { client, calls } = stubWriteClient([
      { error: { code: "23505", message: "duplicate key value" } },
      { data: { id: "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20", key: "teacup-2" } },
    ]);

    const created = await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh: "Teacup",
        category: "home",
        productDescriptionZh: "陶土燒製，容量約 200 毫升。",
      },
      client,
    );

    expect(calls.insert.map((payload) => payload.key)).toEqual([
      "teacup",
      "teacup-2",
    ]);
    expect(created.key).toBe("teacup-2");
  });

  it("normalizes a subcategory label within the given category", async () => {
    const { client, calls } = stubWriteClient([
      { data: { id: "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20", key: "teacup" } },
    ]);

    await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh: "Teacup",
        category: "home",
        productDescriptionZh: "陶土燒製，容量約 200 毫升。",
        subcategory: "餐具",
      },
      client,
    );

    expect(calls.insert.at(0)?.subcategory).toBe("tableware");
  });

  it("refuses to create a visible product without a compatible L2", async () => {
    // Catches bypassing the action schema and publishing a row the database must reject.
    const { client, calls } = stubWriteClient([]);

    await expect(
      createCuratedProduct(
        {
          brandId: BRAND_ID,
          nameZh: "Cross-category bag",
          category: "home",
          subcategory: "handbags",
          visible: true,
          productDescriptionZh: "A product with mismatched taxonomy input.",
        },
        client,
      ),
    ).rejects.toThrow("Visible products require a known subcategory");
    expect(calls.insert).toEqual([]);
  });

  it("createCuratedProduct writes the description and brand-page position", async () => {
    const { client, calls } = stubWriteClient([
      { data: { id: PRODUCT_ID, key: "teacup" } },
    ]);

    await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh: "Teacup",
        category: "home",
        productPosition: 2,
        productDescriptionZh: "杯口薄、杯身厚。",
        productDescriptionEn: "Thin at the lip, thick in the body.",
      },
      client,
    );

    expect(calls.insert.at(0)).toMatchObject({
      product_position: 2,
      product_description_zh: "杯口薄、杯身厚。",
      product_description_en: "Thin at the lip, thick in the body.",
    });
    expect(Object.keys(calls.insert.at(0) ?? {})).not.toContain("notes_zh");
  });

  it("create_persists_material — a ratified slug round-trips onto the inserted row", async () => {
    const { client, calls } = stubWriteClient([
      { data: { id: PRODUCT_ID, key: "teacup" } },
    ]);

    await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh: "Teacup",
        category: "home",
        productDescriptionZh: "陶土燒製，容量約 200 毫升。",
        material: ["wood"],
      },
      client,
    );

    expect(calls.insert.at(0)?.material).toEqual(["wood"]);
  });

  it("create_rejects_unknown_material_slug — an unratified term is dropped, never handed to Postgres", async () => {
    // The column carries a CHECK over the twelve ratified slugs
    // (20260820170000_material_slugs.sql). Letting an unknown term
    // through would 23514 the whole insert and lose the valid terms with it, so
    // the service drops it — the same behaviour as an out-of-category
    // subcategory.
    const { client, calls } = stubWriteClient([
      { data: { id: PRODUCT_ID, key: "teacup" } },
    ]);

    await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh: "Teacup",
        category: "home",
        productDescriptionZh: "陶土燒製，容量約 200 毫升。",
        material: ["wood", "plastic", "resin"],
      },
      client,
    );

    expect(calls.insert.at(0)?.material).toEqual(["wood"]);
  });

  it("create_defaults_material_to_empty_array — an omitted material inserts [], not null", async () => {
    const { client, calls } = stubWriteClient([
      { data: { id: PRODUCT_ID, key: "teacup" } },
    ]);

    await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh: "Teacup",
        category: "home",
        productDescriptionZh: "陶土燒製，容量約 200 毫升。",
      },
      client,
    );

    // `material` is NOT NULL in Postgres: a null here is a 23502, so the writer
    // must always send an array.
    expect(calls.insert.at(0)?.material).toEqual([]);
  });
});

describe("curated product writers", () => {
  it("upserts a placement without rationale", async () => {
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
      },
      client,
    );

    expect(calls.table).toContain("curated_product_selections");
    // A placement is now WHERE a product sits and nothing else — the copy it
    // renders comes from the product row.
    expect(calls.upsert.at(0)).toEqual({
      product_id: PRODUCT_ID,
      trail_slug: "small-space-reading-corner",
      section_key: "light-first",
      position: 2,
      state: "active",
    });
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
      },
      client,
    );
    await upsertCuratedProductSelection(
      {
        productId: PRODUCT_ID,
        trailSlug: "small-space-reading-corner",
        sectionKey: "beside-seat",
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
      },
      client,
    );

    expect(calls.neq).toContainEqual(["product_id", PRODUCT_ID]);
    expect(calls.upsert).toHaveLength(1);
  });

  it("retires a trail selection without deleting it", async () => {
    const { client, calls } = stubWriteClient([
      { data: [{ product_id: PRODUCT_ID }] },
    ]);

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
      { officialUrl: null, productDescriptionEn: null },
      client,
    );

    const payload = calls.update.at(0) ?? {};
    expect(payload.official_url).toBeNull();
    expect(payload.product_description_en).toBeNull();
    expect(Object.keys(payload)).not.toContain("name_zh");
    expect(Object.keys(payload)).not.toContain("product_description_zh");
  });

  it("updateCuratedProduct clears product_position sent as null and skips an absent one", async () => {
    const { client, calls } = stubWriteClient([{}]);

    await updateCuratedProduct(
      PRODUCT_ID,
      { productPosition: null, productDescriptionZh: "重寫過的描述。" },
      client,
    );

    const payload = calls.update.at(0) ?? {};
    expect(payload.product_position).toBeNull();
    expect(payload.product_description_zh).toBe("重寫過的描述。");
    expect(Object.keys(payload)).not.toContain("wall_position");
  });

  it("update_rejects_subcategory_without_category — an L2 is only meaningful inside one L1", async () => {
    const { client, calls } = stubWriteClient([{}]);

    await expect(
      updateCuratedProduct(PRODUCT_ID, { subcategory: "tableware" }, client),
    ).rejects.toThrow(
      "Updating subcategory requires category in the same patch",
    );
    expect(calls.update).toEqual([]);
  });

  it("update_normalizes_subcategory_within_the_patched_category", async () => {
    const { client, calls } = stubWriteClient([{}]);

    await updateCuratedProduct(
      PRODUCT_ID,
      {
        category: "home",
        subcategory: "餐具",
      },
      client,
    );

    const payload = calls.update.at(0) ?? {};
    expect(payload.category).toBe("home");
    expect(payload.subcategory).toBe("tableware");
  });

  it("clears an incompatible L2 and forces the product hidden", async () => {
    // Catches a category move leaving a visible product attached to another L1.
    const { client, calls } = stubWriteClient([{}]);

    await updateCuratedProduct(
      PRODUCT_ID,
      {
        category: "home",
        subcategory: "handbags",
        visible: true,
      },
      client,
    );

    expect(calls.update.at(0)).toMatchObject({
      category: "home",
      subcategory: null,
      visible: false,
    });
  });

  it("clears an explicit L2 and forces the product hidden", async () => {
    // Catches an explicit clear being overwritten by a simultaneous publication request.
    const { client, calls } = stubWriteClient([{}]);

    await updateCuratedProduct(
      PRODUCT_ID,
      { category: "home", subcategory: null, visible: true },
      client,
    );

    expect(calls.update.at(0)).toMatchObject({
      category: "home",
      subcategory: null,
      visible: false,
    });
  });

  it("update payload omits the dropped columns even when a caller supplies them", async () => {
    const { client, calls } = stubWriteClient([{}]);

    await updateCuratedProduct(
      PRODUCT_ID,
      {
        nameZh: "Renamed",
        visible: true,
        wallPosition: 2,
        lifecycle: "published",
        imageUsage: "licensed",
      } as unknown as Parameters<typeof updateCuratedProduct>[1],
      client,
    );

    const payload = calls.update.at(0) ?? {};
    expect(payload.visible).toBe(true);
    expect(Object.keys(payload)).not.toContain("wall_position");
    expect(Object.keys(payload)).not.toContain("lifecycle");
    expect(Object.keys(payload)).not.toContain("image_usage");
  });

  it("retire sets visible=false, never deleting the row", async () => {
    const { client, calls } = stubWriteClient([{}]);

    await retireCuratedProduct("6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20", client);

    expect(calls.table).toEqual(["curated_products"]);
    expect(calls.update.at(0)).toEqual({ visible: false });
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
        {
          brandId: BRAND_ID,
          nameZh: "Teacup",
          category: "home",
          productDescriptionZh: "陶土燒製，容量約 200 毫升。",
        },
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

describe("getCuratedProductWriteContext", () => {
  it("reads brand, image and visibility from the ROW, never from a caller", async () => {
    // A server action is a POST endpoint: a caller-supplied brandId files an
    // upload under another brand's storage prefix, and a caller-supplied
    // previous image URL is a delete primitive over that prefix.
    const { client, calls } = stubWriteClient([
      {
        data: {
          brand_id: BRAND_ID,
          image_url: "https://cdn.example.com/stored.webp",
          image_source_url: "https://example.com/source.png",
          visible: true,
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
      visible: true,
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
              state: "active",
            },
            {
              trail_slug: "small-space-reading-corner",
              section_key: "withdrawn",
              position: 0,
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
      },
    ]);
  });

  // The admin queue is the screen used to REPAIR a bad deploy, so it must not
  // be the screen that 500s during the deploy->migrate window. A renamed column
  // returns 42703 from a table that is already in the schema cache, so guarding
  // on the missing-table code alone let that escape.
  it.each([
    [
      "PGRST205",
      "Could not find the table 'public.curated_products' in the schema cache",
    ],
    ["42703", "column curated_products.visible does not exist"],
  ])("returns [] when the schema lags (%s)", async (code, message) => {
    const { client } = stubClient({ error: { code, message } });

    await expect(listCuratedProductsForAdmin(client)).resolves.toEqual([]);
  });

  it("rethrows any other admin-queue error", async () => {
    const { client } = stubClient({
      error: { code: "42501", message: "permission denied" },
    });

    await expect(listCuratedProductsForAdmin(client)).rejects.toMatchObject({
      code: "42501",
    });
  });
});

/**
 * `supabase/config.toml` sets `max_rows = 1000`, and PostgREST truncates at
 * that ceiling with NO error. This reader returns one row per PRODUCT while its
 * `.in()` chunk bounds BRANDS, and hidden rejection rows accumulate by design,
 * so a single request could silently return a partial map — which reads exactly
 * like "these brands have no history" and makes approval re-insert products a
 * reviewer already rejected under key-suffixed keys.
 */
describe("getCuratedProductsByBrandBatch", () => {
  const BATCH_BRAND_ID = "9d1d5a94-3d2f-4a56-9b04-6f1f5b2b7a10";

  function pagingClient(pages: Record<string, unknown>[][]) {
    const ranges: [number, number][] = [];
    let call = 0;
    const chain = {
      select: () => chain,
      in: () => chain,
      eq: () => chain,
      order: () => chain,
      range(from: number, to: number) {
        ranges.push([from, to]);
        return chain;
      },
      then<TResult>(
        resolve: (value: { data: unknown[]; error: null }) => TResult,
        reject?: (reason: unknown) => TResult,
      ) {
        const page = pages[call] ?? [];
        call += 1;
        return Promise.resolve({ data: page, error: null }).then(
          resolve,
          reject,
        );
      },
    };
    return {
      client: { from: () => chain } as unknown as CuratedProductSupabase,
      ranges,
    };
  }

  function batchRow(index: number) {
    return {
      id: `product-${index}`,
      brand_id: BATCH_BRAND_ID,
      key: `product-${index}`,
      official_url: `https://taoqi.com.tw/products/${index}`,
      visible: false,
      proposed_by: "generated",
      curated_product_sources: [{ id: `source-${index}` }],
    };
  }

  it("pages until a short page rather than trusting one request", async () => {
    const full = Array.from({ length: 500 }, (_, index) => batchRow(index));
    const tail = [batchRow(500), batchRow(501)];
    const { client, ranges } = pagingClient([full, tail]);

    const byBrand = await getCuratedProductsByBrandBatch(
      [BATCH_BRAND_ID],
      client,
    );

    expect(ranges).toEqual([
      [0, 499],
      [500, 999],
    ]);
    expect(byBrand.get(BATCH_BRAND_ID)).toHaveLength(502);
  });

  it("stops after one request when the first page is already short", async () => {
    const { client, ranges } = pagingClient([[batchRow(0)]]);

    const byBrand = await getCuratedProductsByBrandBatch(
      [BATCH_BRAND_ID],
      client,
    );

    expect(ranges).toEqual([[0, 499]]);
    expect(byBrand.get(BATCH_BRAND_ID)).toEqual([
      {
        id: "product-0",
        key: "product-0",
        officialUrl: "https://taoqi.com.tw/products/0",
        visible: false,
        hasActiveSource: true,
        proposedBy: "generated",
        imageSourceUrl: null,
        nameEn: null,
        productDescriptionZh: null,
        productDescriptionEn: null,
        category: null,
        subcategory: null,
        material: null,
      },
    ]);
  });

  it("reports a row with no active source, so the materializer can repair it", async () => {
    const { client } = pagingClient([
      [{ ...batchRow(0), curated_product_sources: [] }],
    ]);

    const byBrand = await getCuratedProductsByBrandBatch(
      [BATCH_BRAND_ID],
      client,
    );

    expect(byBrand.get(BATCH_BRAND_ID)?.at(0)?.hasActiveSource).toBe(false);
  });
});

describe("getBrandTrailSlugs", () => {
  const BRAND_ID = "3f2a1c66-0a5e-4a4c-9d3b-1b7c9a2d5e40";

  it("returns_every_active_trail_slug_for_a_brand", async () => {
    const { client, calls } = stubClient({
      data: [
        { trail_slug: "small-space-reading-corner", state: "active" },
        { trail_slug: "first-apartment-kitchen", state: "active" },
        // Two products of one brand can sit in the same trail. That is one
        // revalidation target, not two.
        { trail_slug: "small-space-reading-corner", state: "active" },
      ],
    });

    const slugs = await getBrandTrailSlugs(BRAND_ID, client);

    expect([...slugs].sort()).toEqual([
      "first-apartment-kitchen",
      "small-space-reading-corner",
    ]);
    // Keyed on the brand through the inner-joined parent: the selections table
    // has no brand_id of its own.
    expect(calls.table).toEqual(["curated_product_selections"]);
    expect(calls.select.at(0)).toContain("curated_products!inner(brand_id)");
    expect(calls.eq).toEqual([
      ["curated_products.brand_id", BRAND_ID],
      ["state", "active"],
    ]);
  });

  it("excludes_retired_selections", async () => {
    const { client } = stubClient({
      data: [
        { trail_slug: "small-space-reading-corner", state: "active" },
        { trail_slug: "first-apartment-kitchen", state: "retired" },
      ],
    });

    // The stub replays its canned rows without evaluating the filters, so this
    // asserts the in-process guard. The `state = active` filter above is what
    // keeps the retired row off the wire in production.
    await expect(getBrandTrailSlugs(BRAND_ID, client)).resolves.toEqual([
      "small-space-reading-corner",
    ]);
  });

  it("throws_on_schema_lag_and_lets_the_caller_decide", async () => {
    const { client } = stubClient({
      error: {
        code: "42703",
        message: "column curated_product_selections.state does not exist",
      },
    });

    // A hidden-brand action must not start failing because production's schema
    // is a deploy behind — but the layer that decides that is the caller, not
    // this read. `brandTrailSlugsForRevalidation` in `src/app/admin/actions.ts`
    // wraps it in `.catch(() => [])`, so the admin write still loses only a
    // cache invalidation. Swallowing it here as well made the tolerance
    // invisible and diverged from the sibling `getCuratedProductTrailSlugs`.
    await expect(getBrandTrailSlugs(BRAND_ID, client)).rejects.toMatchObject({
      code: "42703",
    });
  });
});
