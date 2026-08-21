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
  createDryRunReport,
  dryRunReportPath,
  localizeReputationSummary,
  openDryRunReport,
  supabaseEnvironment,
  type BackfillCounts,
  type BackfillSupabase,
  type DryRunEntry,
  type DryRunEntrySink,
  type DryRunHeader,
  type DryRunLine,
  type DryRunPatchLine,
  type DryRunSummary,
  type SupabaseEnvironment,
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

/** The staging project ref, which is what a local dry run actually reads. */
const STAGING_URL = "https://xwkigpvnheecihpxyvsl.supabase.co";
const STAGING: SupabaseEnvironment = supabaseEnvironment(STAGING_URL);

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
        // The substitutions `fixBannedTerms` already returned, carried on the
        // patch. The dry-run report reads these instead of re-scanning every
        // patched value a second time across five tables.
        terms: {
          name_zh: [{ term: BANNED, replacement: CORRECTED, count: 1 }],
          product_description_zh: [
            { term: BANNED_LINK, replacement: CORRECTED_LINK, count: 1 },
          ],
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
        terms: {
          summary_zh: [{ term: BANNED, replacement: CORRECTED, count: 1 }],
          image_alt_zh: [
            { term: BANNED_LINK, replacement: CORRECTED_LINK, count: 1 },
          ],
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
    // Terms from BOTH sides of the jsonb column, merged onto the one column the
    // patch actually writes.
    expect(result.terms).toEqual(
      expect.arrayContaining([
        { term: BANNED, replacement: CORRECTED, count: 1 },
      ]),
    );
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
    expect(patches[0]?.terms.reputation_summary).toEqual(
      expect.arrayContaining([
        { term: BANNED, replacement: CORRECTED, count: 1 },
      ]),
    );
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

/** An in-memory sink, standing in for the file the operator reads. */
function recordingSink(): DryRunEntrySink & { written: DryRunEntry[] } {
  const written: DryRunEntry[] = [];
  return {
    written,
    write: async (entry) => {
      written.push(entry);
    },
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
  });

  it("hands every entry to the sink instead of accumulating them", async () => {
    // The memory bound: a first full-table run must not hold every before AND
    // after of every patched field resident until one JSON.stringify.
    const calls = emptyCalls();
    const client = fakeClient(
      {
        curated_products: [
          Array.from({ length: 12 }, (_, index) =>
            dirtyProduct(`row-${index}`),
          ),
        ],
      },
      calls,
    );
    const sink = recordingSink();

    const counts = await backfillTable(
      client,
      CURATED_PRODUCTS_TABLE,
      { dryRun: true },
      sink,
    );

    expect(sink.written).toHaveLength(24);
    expect(Object.keys(counts.dryRun ?? {})).toEqual(["terms"]);
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
    // Only the changed columns — the terms ride alongside the patch and are
    // never sent to PostgREST.
    expect(calls.updates).toEqual([
      {
        name_zh: `高${CORRECTED}保溫瓶`,
        product_description_zh: `官網有產品${CORRECTED_LINK}。`,
      },
    ]);
  });
});

describe("supabaseEnvironment", () => {
  it("reads the project ref out of a hosted Supabase URL", () => {
    expect(supabaseEnvironment(STAGING_URL)).toEqual({
      projectRef: "xwkigpvnheecihpxyvsl",
      host: "xwkigpvnheecihpxyvsl.supabase.co",
    });
  });

  it("falls back to the host for a local or self-hosted stack", () => {
    expect(supabaseEnvironment("http://127.0.0.1:54321")).toEqual({
      projectRef: "127-0-0-1-54321",
      host: "127.0.0.1:54321",
    });
  });

  it("never leaves the environment unanswered", () => {
    expect(supabaseEnvironment(undefined).projectRef).toBe("unknown");
    expect(supabaseEnvironment("not a url").projectRef).toBe("unknown");
  });
});

/**
 * DEV-1546 Phase 2. `--dry-run` is now the ONLY mutation path for stored zh-TW
 * text, and a human reading its diff is the entire safety mechanism against
 * `fixBannedTerms` rewriting correct Taiwanese words that merely CONTAIN a
 * banned term (台南市保安路 -> 保全路). The 10-row / 80-char terminal sample
 * cannot carry that review: on staging one sample printed an identical
 * before/after because the actual change sat past the cutoff. These tests pin
 * the complete, untruncated NDJSON file that replaced it as the review artifact.
 */
describe("dry-run report file", () => {
  function readLines(path: string): DryRunLine[] {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as DryRunLine);
  }

  function readHeader(path: string): DryRunHeader {
    return readLines(path)[0] as DryRunHeader;
  }

  function readPatches(path: string): DryRunPatchLine[] {
    return readLines(path).filter(
      (line): line is DryRunPatchLine => line.kind === "patch",
    );
  }

  function readSummary(path: string): DryRunSummary {
    const lines = readLines(path);
    return lines[lines.length - 1] as DryRunSummary;
  }

  function tempReportPath(): string {
    return join(
      mkdtempSync(join(tmpdir(), "backfill-tw-report-")),
      "nested",
      "report.ndjson",
    );
  }

  /** Open, run the backfill against the open report, close. As `main` does. */
  async function writeReport(
    path: string,
    run: (
      sink: DryRunEntrySink,
    ) => Promise<readonly (readonly [string, BackfillCounts])[]>,
  ): Promise<DryRunSummary> {
    const report = await createDryRunReport(path, STAGING);
    const sections = await run(report);
    return report.finish(sections);
  }

  it("writes every patch to the file, not a sample", async () => {
    // Deliberately past the old 10-row terminal cap: the file must not cap.
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

    const path = tempReportPath();
    const summary = await writeReport(path, async (sink) => {
      const counts = await backfillTable(
        client,
        CURATED_PRODUCTS_TABLE,
        { dryRun: true },
        sink,
      );
      return [["curated_products", counts]];
    });

    const patches = readPatches(path);
    // Two patched columns per row.
    expect(patches).toHaveLength(rowCount * 2);
    expect(summary.entryCount).toBe(rowCount * 2);
    expect(summary.rowsByTable).toEqual({ curated_products: rowCount });
    for (let index = 0; index < rowCount; index += 1) {
      expect(
        patches.filter((entry) => entry.key.id === `row-${index}`),
      ).toHaveLength(2);
    }
  });

  it("contains untruncated before and after text", async () => {
    // The change sits well past the old 80-character sample cutoff, which is
    // the exact staging failure: an identical-looking before/after.
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

    const path = tempReportPath();
    await writeReport(path, async (sink) => {
      await backfillTable(
        client,
        CURATED_PRODUCTS_TABLE,
        { dryRun: true },
        sink,
      );
      return [];
    });

    const entry = readPatches(path)[0];
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

    const path = tempReportPath();
    await writeReport(path, async (sink) => {
      await backfillFaq(client, { dryRun: true }, sink);
      return [];
    });

    const entry = readPatches(path)[0];
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

  it("is one JSON object per line, opening with a header and closing with a summary", async () => {
    const calls = emptyCalls();
    const client = fakeClient(
      { curated_products: [[dirtyProduct(PRODUCT_ID)]] },
      calls,
    );

    const path = tempReportPath();
    await writeReport(path, async (sink) => {
      const counts = await backfillTable(
        client,
        CURATED_PRODUCTS_TABLE,
        { dryRun: true },
        sink,
      );
      return [["curated_products", counts]];
    });

    const lines = readLines(path);
    expect(lines.map((line) => line.kind)).toEqual([
      "header",
      "patch",
      "patch",
      "summary",
    ]);
    // Greppable line by line: a crash mid-run leaves a partial artifact whose
    // every complete line still parses.
    expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
  });

  it("names the database in both the report and the filename", async () => {
    // Both .env.local and .env.staging point at STAGING, and production
    // credentials come from a separate reveal step — so a report that does not
    // say which database it describes lets a reviewer approve one environment's
    // diff and apply it against the other.
    const path = tempReportPath();
    const summary = await writeReport(path, async () => []);

    expect(readHeader(path).environment).toEqual(STAGING);
    expect(summary.environment.projectRef).toBe("xwkigpvnheecihpxyvsl");
    // Read back off disk, not just the value finish() returned: the summary is
    // the last line, so a reviewer opening a completed report sees the database
    // named at both ends of the file.
    expect(readSummary(path).environment).toEqual(STAGING);
    // In the file, so a grep finds it even in a partial artifact.
    expect(readFileSync(path, "utf8")).toContain("xwkigpvnheecihpxyvsl");
    // And on disk, so two environments' reports are distinguishable unopened.
    expect(
      dryRunReportPath({ projectRef: summary.environment.projectRef }),
    ).toContain("xwkigpvnheecihpxyvsl");
  });

  it("is not opened at all on a non-dry run", async () => {
    // The real call site: main asks for a report in both modes and gets null in
    // one of them, so the path it prints is never a stringified null.
    const path = tempReportPath();

    const report = await openDryRunReport({ dryRun: false }, STAGING, path);

    expect(report).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  it("opens a real, typed path on a dry run", async () => {
    const path = tempReportPath();

    const report = await openDryRunReport({ dryRun: true }, STAGING, path);

    expect(report?.path).toBe(path);
    await report?.finish([]);
    expect(existsSync(path)).toBe(true);
  });

  it("puts the report in the gitignored artifact root, stamped per run", () => {
    const now = new Date();
    const path = dryRunReportPath({
      projectRef: STAGING.projectRef,
      now,
      pid: 4242,
    });

    expect(path.startsWith(`${ARTIFACT_ROOT}/`)).toBe(true);
    expect(path.endsWith(".ndjson")).toBe(true);
    // A concurrent run must not overwrite this one's evidence.
    expect(path).toContain("4242");
    expect(path).not.toBe(
      dryRunReportPath({ projectRef: STAGING.projectRef, now, pid: 4243 }),
    );
  });
});
