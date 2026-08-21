import { describe, expect, it } from "vitest";
import {
  CURATED_PRODUCTS_TABLE,
  PAGE_SIZE,
  backfillFaq,
  backfillTable,
  buildCuratedProductPatches,
  buildExhibitorPatches,
  buildBrandPatches,
  localizeReputationSummary,
  type BackfillSupabase,
} from "./backfill-tw-localization";

/**
 * DEV-1543. The patch builders are pure, so they are tested directly; the only
 * I/O assertion here is the one that matters operationally — `--dry-run` must
 * build patches and issue no update.
 */

const BANNED = "質量";
const CORRECTED = "品質";
const BANNED_LINK = "鏈接";
const CORRECTED_LINK = "連結";

const PRODUCT_ID = "11111111-1111-1111-1111-111111111111";
const EXHIBITOR_ID = "33333333-3333-3333-3333-333333333333";
const BRAND_ID = "22222222-2222-2222-2222-222222222222";

describe("buildCuratedProductPatches", () => {
  it("builds a curated_products patch for a banned term", () => {
    const patches = buildCuratedProductPatches([
      {
        id: PRODUCT_ID,
        name_zh: `高${BANNED}保溫瓶`,
        product_description_zh: `官網有產品${BANNED_LINK}。`,
      },
    ]);

    expect(patches).toEqual([
      {
        id: PRODUCT_ID,
        patch: {
          name_zh: `高${CORRECTED}保溫瓶`,
          product_description_zh: `官網有產品${CORRECTED_LINK}。`,
        },
      },
    ]);
  });

  it("emits no patch for clean rows", () => {
    expect(
      buildCuratedProductPatches([
        {
          id: PRODUCT_ID,
          name_zh: `高${CORRECTED}保溫瓶`,
          product_description_zh: `官網有產品${CORRECTED_LINK}。`,
        },
      ]),
    ).toEqual([]);
  });
});

describe("buildExhibitorPatches", () => {
  it("builds an event_exhibitors patch", () => {
    const patches = buildExhibitorPatches([
      {
        id: EXHIBITOR_ID,
        summary_zh: `以${BANNED}見長的工作室。`,
        image_alt_zh: `攤位${BANNED_LINK}照片`,
      },
    ]);

    expect(patches).toEqual([
      {
        id: EXHIBITOR_ID,
        patch: {
          summary_zh: `以${CORRECTED}見長的工作室。`,
          image_alt_zh: `攤位${CORRECTED_LINK}照片`,
        },
      },
    ]);
  });
});

describe("reputation_summary", () => {
  it("covers textEn as well as text", () => {
    const result = localizeReputationSummary({
      text: `評價集中在${BANNED}。`,
      textEn: "Reviews call it YYDS.",
      sources: ["https://example.com"],
    });

    expect(result.changed).toBe(true);
    expect(result.value).toEqual({
      text: `評價集中在${CORRECTED}。`,
      textEn: "Reviews call it 太神了.",
      sources: ["https://example.com"],
    });
  });

  it("reaches reputation_summary through the brand patch builder", () => {
    const patches = buildBrandPatches([
      {
        id: BRAND_ID,
        name: "Formoria",
        description: null,
        blurb: null,
        reputation_summary: {
          text: `評價集中在${BANNED}。`,
          textEn: "Reviews call it YYDS.",
        },
      },
    ]);

    expect(patches).toHaveLength(1);
    expect(patches[0]?.patch.reputation_summary).toEqual({
      text: `評價集中在${CORRECTED}。`,
      textEn: "Reviews call it 太神了.",
    });
  });
});

/**
 * A PostgREST double covering exactly the slice this script uses:
 * `from(...).select(...).or(...).order(...).range(...)` for reads and
 * `from(...).update(...).eq(...)` for writes. Every call is recorded, because
 * the paging and ordering contracts ARE the assertions.
 */
type FakeCalls = {
  ranges: [number, number][];
  orders: string[];
  filters: string[];
  updates: unknown[];
};

type EqChain = {
  eq: () => EqChain;
  then: (resolve: (value: { error: null }) => void) => void;
};

function fakeClient(
  pages: Record<string, unknown[][]>,
  calls: FakeCalls,
): BackfillSupabase {
  const cursors: Record<string, number> = {};
  const eqChain: EqChain = {
    eq: () => eqChain,
    then: (resolve) => resolve({ error: null }),
  };

  return {
    from: (table: string) => ({
      select: () => {
        const builder = {
          or: (filter: string) => {
            calls.filters.push(filter);
            return builder;
          },
          order: (column: string) => {
            calls.orders.push(column);
            return builder;
          },
          range: async (from: number, to: number) => {
            calls.ranges.push([from, to]);
            const index = cursors[table] ?? 0;
            cursors[table] = index + 1;
            return { data: pages[table]?.[index] ?? [], error: null };
          },
        };
        return builder;
      },
      update: (payload: unknown) => {
        calls.updates.push(payload);
        return eqChain;
      },
    }),
  } as unknown as BackfillSupabase;
}

function emptyCalls(): FakeCalls {
  return { ranges: [], orders: [], filters: [], updates: [] };
}

function dirtyProduct(id: string) {
  return {
    id,
    name_zh: `高${BANNED}保溫瓶`,
    product_description_zh: `官網有產品${BANNED_LINK}。`,
  };
}

describe("--dry-run", () => {
  it("produces patches and issues no update", async () => {
    const calls = emptyCalls();
    const client = fakeClient(
      { curated_products: [[dirtyProduct(PRODUCT_ID)]] },
      calls,
    );

    const counts = await backfillTable(client, CURATED_PRODUCTS_TABLE, {
      dryRun: true,
    });

    expect(counts.updated).toBe(1);
    expect(calls.updates).toEqual([]);
  });

  it("names the banned terms it would rewrite, with per-term counts", async () => {
    const calls = emptyCalls();
    const client = fakeClient(
      {
        curated_products: [
          [
            dirtyProduct(PRODUCT_ID),
            dirtyProduct("22222222-0000-0000-0000-000000000002"),
          ],
        ],
      },
      calls,
    );

    const counts = await backfillTable(client, CURATED_PRODUCTS_TABLE, {
      dryRun: true,
    });

    // The operator's safety check greps this output for specific terms, so the
    // terms must appear in it — a bare row count passes that grep vacuously.
    expect(counts.dryRun?.terms).toEqual(
      expect.arrayContaining([
        { term: BANNED, replacement: CORRECTED, count: 2 },
        { term: BANNED_LINK, replacement: CORRECTED_LINK, count: 2 },
      ]),
    );
    expect(counts.dryRun?.samples[0]).toContain(PRODUCT_ID);
    expect(counts.dryRun?.samples[0]).toContain("->");
  });
});

describe("pagination", () => {
  it("reads past the first page instead of stopping at the PostgREST cap", async () => {
    const calls = emptyCalls();
    const firstPage = Array.from({ length: PAGE_SIZE }, (_, index) =>
      dirtyProduct(`page-1-${index}`),
    );
    const shortPage = [dirtyProduct("page-2-0"), dirtyProduct("page-2-1")];
    const client = fakeClient(
      { curated_products: [firstPage, shortPage] },
      calls,
    );

    const counts = await backfillTable(client, CURATED_PRODUCTS_TABLE, {
      dryRun: true,
    });

    expect(counts.updated).toBe(PAGE_SIZE + 2);
    expect(calls.ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
    ]);
    // Deterministic order, or two pages could overlap or skip rows.
    expect(calls.orders).toEqual(["id", "id"]);
    // Rows with nothing localizable never leave the database.
    expect(calls.filters[0]).toBe(
      "name_zh.not.is.null,product_description_zh.not.is.null",
    );
  });

  it("orders brand_faq_entries by its whole composite key", async () => {
    const calls = emptyCalls();
    const client = fakeClient({ brand_faq_entries: [[]] }, calls);

    await backfillFaq(client, { dryRun: true });

    expect(calls.orders).toEqual(["brand_id", "preset_id", "position"]);
  });
});

describe("write path", () => {
  it("issues one update per patched row when not a dry run", async () => {
    const calls = emptyCalls();
    const client = fakeClient(
      { curated_products: [[dirtyProduct(PRODUCT_ID)]] },
      calls,
    );

    const counts = await backfillTable(client, CURATED_PRODUCTS_TABLE, {
      dryRun: false,
    });

    expect(counts.updated).toBe(1);
    expect(counts.dryRun).toBeUndefined();
    expect(calls.updates).toEqual([
      {
        name_zh: `高${CORRECTED}保溫瓶`,
        product_description_zh: `官網有產品${CORRECTED_LINK}。`,
      },
    ]);
  });
});
