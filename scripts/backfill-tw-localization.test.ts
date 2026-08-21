import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  CURATED_PRODUCTS_TABLE,
  PAGE_SIZE,
  backfillFaq,
  backfillTable,
  buildCuratedProductPatches,
  buildExhibitorPatches,
  buildBrandPatches,
  dryRunReportPath,
  localizeReputationSummary,
  reportDryRun,
  type BackfillSupabase,
  type DryRunReport,
} from "./backfill-tw-localization";
import { ARTIFACT_ROOT } from "./shared/artifact";

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

/**
 * DEV-1546 Phase 2. `--dry-run` is now the ONLY mutation path for stored zh-TW
 * text, and a human reading its diff is the entire safety mechanism against
 * `fixBannedTerms` rewriting correct Taiwanese words that merely CONTAIN a
 * banned term (台南市保安路 -> 保全路). The 10-row / 80-char terminal sample
 * cannot carry that review: on staging one sample printed an identical
 * before/after because the actual change sat past the cutoff. These tests pin
 * the complete, untruncated file that replaced it as the review artifact.
 */
describe("dry-run report file", () => {
  function readReport(path: string): DryRunReport {
    return JSON.parse(readFileSync(path, "utf8")) as DryRunReport;
  }

  function tempReportPath(): string {
    return join(
      mkdtempSync(join(tmpdir(), "backfill-tw-report-")),
      "nested",
      "report.json",
    );
  }

  it("writes every patch to the file, not a sample", async () => {
    // Deliberately past DRY_RUN_SAMPLE_LIMIT (10): the terminal preview caps,
    // the file must not.
    const rowCount = 25;
    const calls = emptyCalls();
    const client = fakeClient(
      {
        curated_products: [
          Array.from({ length: rowCount }, (_, index) =>
            dirtyProduct(`row-${index}`),
          ),
        ],
      },
      calls,
    );

    const counts = await backfillTable(client, CURATED_PRODUCTS_TABLE, {
      dryRun: true,
    });
    const path = tempReportPath();
    const written = await reportDryRun(
      { dryRun: true },
      [["curated_products", counts]],
      path,
    );

    expect(written).toBe(path);
    const report = readReport(path);
    // Two patched columns per row.
    expect(report.entries).toHaveLength(rowCount * 2);
    expect(report.entryCount).toBe(rowCount * 2);
    for (let index = 0; index < rowCount; index += 1) {
      expect(
        report.entries.filter((entry) => entry.key.id === `row-${index}`),
      ).toHaveLength(2);
    }
    // The terminal preview still caps; the file is the complete record.
    expect(counts.dryRun?.samples).toHaveLength(10);
  });

  it("contains untruncated before and after text", async () => {
    // The change sits well past the 80-character sample cutoff, which is the
    // exact staging failure: an identical-looking before/after.
    const prefix = "台".repeat(200);
    const before = `${prefix}以${BANNED}見長`;
    const after = `${prefix}以${CORRECTED}見長`;
    const calls = emptyCalls();
    const client = fakeClient(
      {
        curated_products: [
          [
            {
              id: PRODUCT_ID,
              name_zh: null,
              product_description_zh: before,
            },
          ],
        ],
      },
      calls,
    );

    const counts = await backfillTable(client, CURATED_PRODUCTS_TABLE, {
      dryRun: true,
    });
    const path = tempReportPath();
    await reportDryRun({ dryRun: true }, [["curated_products", counts]], path);

    const entry = readReport(path).entries[0];
    expect(entry?.before).toBe(before);
    expect(entry?.after).toBe(after);
    expect(entry?.before).not.toContain("…");
    // The reviewer must be able to see the difference, not just its existence.
    expect(entry?.before.slice(80)).not.toBe(entry?.after.slice(80));
    expect(entry?.terms).toEqual([
      { term: BANNED, replacement: CORRECTED, count: 1 },
    ]);
    // Readable zh, not \uXXXX escapes — a reviewer reads this file directly.
    expect(readFileSync(path, "utf8")).toContain(CORRECTED);
  });

  it("records the composite key for brand_faq_entries", async () => {
    const calls = emptyCalls();
    const client = fakeClient(
      {
        brand_faq_entries: [
          [
            {
              brand_id: BRAND_ID,
              preset_id: "shipping",
              position: 3,
              question_zh: `運送${BANNED}如何？`,
              answer_zh: null,
            },
          ],
        ],
      },
      calls,
    );

    const counts = await backfillFaq(client, { dryRun: true });
    const path = tempReportPath();
    await reportDryRun(
      { dryRun: true },
      [["brand_faq_entries", counts]],
      path,
    );

    const entry = readReport(path).entries[0];
    expect(entry?.table).toBe("brand_faq_entries");
    expect(entry?.key).toEqual({
      brand_id: BRAND_ID,
      preset_id: "shipping",
      position: 3,
    });
    expect(entry?.field).toBe("question_zh");
    expect(entry?.before).toBe(`運送${BANNED}如何？`);
    expect(entry?.after).toBe(`運送${CORRECTED}如何？`);
  });

  it("is not written on a non-dry run", async () => {
    const calls = emptyCalls();
    const client = fakeClient(
      { curated_products: [[dirtyProduct(PRODUCT_ID)]] },
      calls,
    );

    const counts = await backfillTable(client, CURATED_PRODUCTS_TABLE, {
      dryRun: false,
    });
    const path = tempReportPath();
    const written = await reportDryRun(
      { dryRun: false },
      [["curated_products", counts]],
      path,
    );

    expect(written).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  it("puts the report in the gitignored artifact root, stamped per run", () => {
    const path = dryRunReportPath(new Date(), 4242);

    expect(path.startsWith(`${ARTIFACT_ROOT}/`)).toBe(true);
    expect(path.endsWith(".json")).toBe(true);
    // A concurrent run must not overwrite this one's evidence.
    expect(path).toContain("4242");
    expect(path).not.toBe(dryRunReportPath(new Date(), 4243));
  });
});
