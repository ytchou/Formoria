import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  CURATED_PRODUCTS_TABLE,
  PAGE_SIZE,
  applyApproved,
  assertSameEnvironment,
  buildCuratedProductPatches,
  buildExhibitorPatches,
  buildBrandPatches,
  createDryRunReport,
  dryRunReportPath,
  localizeReputationSummary,
  openDryRunReport,
  parseArgs,
  parseManifest,
  scanFaq,
  scanTable,
  supabaseEnvironment,
  type ApprovedEntry,
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

    const counts = await scanTable(client, CURATED_PRODUCTS_TABLE);

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

    const counts = await scanTable(client, CURATED_PRODUCTS_TABLE);

    // The operator's safety check greps this output for specific terms, so the
    // terms must appear in it — a bare row count passes that grep vacuously.
    expect(counts.terms).toEqual(
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

    const counts = await scanTable(client, CURATED_PRODUCTS_TABLE, sink);

    expect(sink.written).toHaveLength(24);
    // The scan keeps per-term totals and nothing else resident: no array of
    // entries, and no second copy of what already went to the sink.
    expect(Object.keys(counts).sort()).toEqual(["terms", "updated"]);
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

    const counts = await scanTable(client, CURATED_PRODUCTS_TABLE);

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

    await scanFaq(client);

    expect(calls.orders).toEqual(["brand_id", "preset_id", "position"]);
  });
});

/**
 * DEV-1547 E1. The scan is the ONLY thing that reads the tables, and it can no
 * longer write: the mode where it applied everything it had just computed is
 * what made the first production run unusable (15 patches proposed, 5 correct,
 * no way to take 5).
 */
describe("the scan never writes", () => {
  it("issues no update even with a full page of patchable rows", async () => {
    const calls = emptyCalls();
    const client = fakeClient(
      {
        curated_products: [[dirtyProduct(PRODUCT_ID), dirtyProduct("row-2")]],
      },
      calls,
    );

    const counts = await scanTable(client, CURATED_PRODUCTS_TABLE);

    expect(counts.updated).toBe(2);
    expect(calls.updates).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("takes a dry run", () => {
    expect(parseArgs(["--dry-run"])).toEqual({ mode: "dry-run" });
  });

  it("takes an apply with its manifest", () => {
    expect(parseArgs(["--apply", "/tmp/report.ndjson"])).toEqual({
      mode: "apply",
      manifestPath: "/tmp/report.ndjson",
    });
  });

  it("refuses a bare run rather than defaulting to either mode", () => {
    // A default of dry-run would make --apply look optional; a default of
    // apply is the E1 defect itself.
    expect(() => parseArgs([])).toThrow(/Nothing to do/);
  });

  it("refuses both modes at once", () => {
    expect(() => parseArgs(["--dry-run", "--apply", "x.ndjson"])).toThrow(
      /not both/,
    );
  });

  it("refuses --apply with no manifest path", () => {
    expect(() => parseArgs(["--apply"])).toThrow(/needs the path/);
    // The next flag is not a path: a manifest is never optional.
    expect(() => parseArgs(["--apply", "--verbose"])).toThrow(/needs the path/);
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
      const counts = await scanTable(client, CURATED_PRODUCTS_TABLE, sink);
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
      await scanTable(client, CURATED_PRODUCTS_TABLE, sink);
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
      await scanFaq(client, sink);
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
      const counts = await scanTable(client, CURATED_PRODUCTS_TABLE, sink);
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

  it("is not opened at all on an apply run", async () => {
    // The real call site: main asks for a report in both modes and gets null on
    // an apply, so the path it prints is never a stringified null.
    const path = tempReportPath();

    const report = await openDryRunReport(
      { mode: "apply", manifestPath: path },
      STAGING,
      path,
    );

    expect(report).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  it("opens a real, typed path on a dry run", async () => {
    const path = tempReportPath();

    const report = await openDryRunReport({ mode: "dry-run" }, STAGING, path);

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

describe("English fields keep ASCII punctuation", () => {
  /*
   * DEV-1547 Class 2. `reputation_summary.textEn` is an ENGLISH sentence that
   * may name a studio in Han characters. `normalizePunctuation` full-widths any
   * punctuation touching CJK, which is right inside a Chinese sentence and
   * wrong inside an English one: the production dry-run turned
   * `T Shape Of (謝工作室) focuses` into `（謝工作室）` on two brands with an
   * EMPTY terms array — no banned term fired, the formatting pass did it alone.
   *
   * Pruning the term list cannot reach this, which is why it is pinned here.
   */
  const EN_WITH_HAN =
    "T Shape Of (謝工作室) focuses on handmade ceramic creations.";

  it("leaves textEn byte-identical when no banned term fires", () => {
    const result = localizeReputationSummary({
      text: "評價集中在手感。",
      textEn: EN_WITH_HAN,
      sources: ["https://example.com"],
    });

    expect(result.changed).toBe(false);
    expect((result.value as { textEn: string }).textEn).toBe(EN_WITH_HAN);
  });

  it("still applies the vocabulary pass to textEn", () => {
    const result = localizeReputationSummary({
      text: "評價集中在手感。",
      textEn: "Reviews call it YYDS (謝工作室).",
    });

    expect(result.changed).toBe(true);
    expect((result.value as { textEn: string }).textEn).toBe(
      "Reviews call it 太神了 (謝工作室).",
    );
  });

  it("keeps full-width punctuation on the Chinese side", () => {
    const result = localizeReputationSummary({
      text: "評價集中在(手感)。",
      textEn: "Nothing to change here.",
    });

    expect(result.changed).toBe(true);
    expect((result.value as { text: string }).text).toBe(
      "評價集中在（手感）。",
    );
  });
});
/**
 * DEV-1547 E1 + E2. The dry-run report is the apply manifest: the reviewer adds
 * `"approve": true` to the patch lines they accept, and `--apply` replays those
 * lines verbatim after checking each row still holds the text they reviewed.
 *
 * Both escalations are behavioural, so both are pinned here against the fakes:
 * a subset must be applicable (E1), and a row that moved between review and
 * apply must abort the run instead of being rewritten unreviewed (E2).
 */
describe("apply from an approved manifest", () => {
  type ApplyCall = {
    table: string;
    key: Record<string, unknown>;
    patch: Record<string, unknown>;
  };

  type ApplyCalls = {
    reads: { table: string; key: Record<string, unknown> }[];
    updates: ApplyCall[];
  };

  function emptyApplyCalls(): ApplyCalls {
    return { reads: [], updates: [] };
  }

  /**
   * A PostgREST double for the apply path only: keyed single-row reads
   * (`select().eq()...limit()`) and keyed updates (`update().eq()...`), over an
   * in-memory store the test can mutate between the two.
   */
  function applyClient(
    store: Record<string, Record<string, unknown>[]>,
    calls: ApplyCalls,
  ): BackfillSupabase {
    return {
      from: (table: string) => ({
        select: () => {
          const key: Record<string, unknown> = {};
          const chain = {
            eq: (column: string, value: unknown) => {
              key[column] = value;
              return chain;
            },
            limit: async (count: number) => {
              calls.reads.push({ table, key: { ...key } });
              const matched = (store[table] ?? []).filter((row) =>
                Object.entries(key).every(([column, value]) => {
                  return row[column] === value;
                }),
              );
              return { data: matched.slice(0, count), error: null };
            },
          };
          return chain;
        },
        update: (patch: Record<string, unknown>) => {
          const key: Record<string, unknown> = {};
          const chain = {
            eq: (column: string, value: unknown) => {
              key[column] = value;
              return chain;
            },
            then: (resolve: (value: { error: null }) => void) => {
              calls.updates.push({ table, key: { ...key }, patch });
              resolve({ error: null });
            },
          };
          return chain;
        },
      }),
    } as unknown as BackfillSupabase;
  }

  /** Render report entries as the NDJSON file, approving the chosen fields. */
  function manifestFor(
    entries: readonly DryRunEntry[],
    approve: (entry: DryRunEntry) => boolean,
  ): string {
    return [
      JSON.stringify({
        kind: "header",
        generatedAt: new Date().toISOString(),
        environment: STAGING,
      }),
      ...entries.map((entry) =>
        JSON.stringify(
          approve(entry)
            ? { kind: "patch", ...entry, approve: true }
            : { kind: "patch", ...entry },
        ),
      ),
    ].join("\n");
  }

  /** Scan a store, and hand back the entries the reviewer would read. */
  async function scanForReview(
    store: Record<string, Record<string, unknown>[]>,
  ): Promise<DryRunEntry[]> {
    const sink = recordingSink();
    await scanTable(
      fakeClient(
        { curated_products: [store.curated_products ?? []] },
        emptyCalls(),
      ),
      CURATED_PRODUCTS_TABLE,
      sink,
    );
    return sink.written;
  }

  function approvedFrom(
    entries: readonly DryRunEntry[],
    approve: (entry: DryRunEntry) => boolean,
  ): ApprovedEntry[] {
    return parseManifest(manifestFor(entries, approve)).approved;
  }

  it("writes only the patches the reviewer approved", async () => {
    // The production shape in miniature: three patchable fields across two
    // rows, one of which the reviewer accepts.
    const store = {
      curated_products: [
        dirtyProduct(PRODUCT_ID) as Record<string, unknown>,
        dirtyProduct("row-2") as Record<string, unknown>,
      ],
    };
    const entries = await scanForReview(store);
    expect(entries).toHaveLength(4);

    const approved = approvedFrom(
      entries,
      (entry) => entry.key.id === PRODUCT_ID && entry.field === "name_zh",
    );
    expect(approved).toHaveLength(1);

    const calls = emptyApplyCalls();
    const result = await applyApproved(applyClient(store, calls), approved);

    expect(result).toEqual({
      applied: 1,
      rowsByTable: { curated_products: 1 },
    });
    expect(calls.updates).toEqual([
      {
        table: "curated_products",
        key: { id: PRODUCT_ID },
        patch: { name_zh: `高${CORRECTED}保溫瓶` },
      },
    ]);
  });

  it("aborts without writing when a row changed since it was reviewed", async () => {
    const store = {
      curated_products: [dirtyProduct(PRODUCT_ID) as Record<string, unknown>],
    };
    const approved = approvedFrom(await scanForReview(store), () => true);

    // Enrichment re-authors the row while the human is still reading the diff.
    store.curated_products[0]!.product_description_zh = `官網有新的${BANNED_LINK}。`;

    const calls = emptyApplyCalls();
    await expect(
      applyApproved(applyClient(store, calls), approved),
    ).rejects.toThrow(/value_changed/);

    // Nothing at all: not even the field that did not move. A half-applied
    // manifest is the one outcome the reviewer cannot reason about.
    expect(calls.updates).toEqual([]);
  });

  it("reports a row that disappeared rather than writing it back", async () => {
    const store = {
      curated_products: [dirtyProduct(PRODUCT_ID) as Record<string, unknown>],
    };
    const approved = approvedFrom(await scanForReview(store), () => true);
    store.curated_products = [];

    const calls = emptyApplyCalls();
    await expect(
      applyApproved(applyClient(store, calls), approved),
    ).rejects.toThrow(/row_missing/);
    expect(calls.updates).toEqual([]);
  });

  it("replays the approved text, not a value recomputed from the term list", async () => {
    const store = {
      curated_products: [dirtyProduct(PRODUCT_ID) as Record<string, unknown>],
    };
    const approved = approvedFrom(
      await scanForReview(store),
      (entry) => entry.field === "name_zh",
    );
    // What lands is the string in the file, whatever the current rules would
    // now produce from the same row.
    const edited: ApprovedEntry[] = approved.map((entry) => ({
      ...entry,
      after: "operator's own wording",
    }));

    const calls = emptyApplyCalls();
    await applyApproved(applyClient(store, calls), edited);

    expect(calls.updates[0]?.patch).toEqual({
      name_zh: "operator's own wording",
    });
  });

  it("writes a jsonb column back as an object, not as its stringified form", async () => {
    const before = {
      text: `評價集中在${BANNED}。`,
      textEn: "Reviews call it YYDS.",
    };
    const after = {
      text: `評價集中在${CORRECTED}。`,
      textEn: "Reviews call it 太神了.",
    };
    const approved: ApprovedEntry[] = [
      {
        table: "brands",
        key: { id: BRAND_ID },
        field: "reputation_summary",
        before: JSON.stringify(before),
        after: JSON.stringify(after),
        encoding: "json",
      },
    ];
    const store = {
      brands: [
        { id: BRAND_ID, reputation_summary: before } as Record<string, unknown>,
      ],
    };

    const calls = emptyApplyCalls();
    await applyApproved(applyClient(store, calls), approved);

    expect(calls.updates[0]?.patch).toEqual({ reputation_summary: after });
  });

  it("keys a brand_faq_entries update on the whole composite key", async () => {
    const approved: ApprovedEntry[] = [
      {
        table: "brand_faq_entries",
        key: { brand_id: BRAND_ID, preset_id: "shipping", position: 3 },
        field: "question_zh",
        before: `運送${BANNED}如何？`,
        after: `運送${CORRECTED}如何？`,
        encoding: "text",
      },
    ];
    const store = {
      brand_faq_entries: [
        {
          brand_id: BRAND_ID,
          preset_id: "shipping",
          position: 3,
          question_zh: `運送${BANNED}如何？`,
        } as Record<string, unknown>,
      ],
    };

    const calls = emptyApplyCalls();
    await applyApproved(applyClient(store, calls), approved);

    expect(calls.reads[0]?.key).toEqual({
      brand_id: BRAND_ID,
      preset_id: "shipping",
      position: 3,
    });
    expect(calls.updates[0]?.key).toEqual({
      brand_id: BRAND_ID,
      preset_id: "shipping",
      position: 3,
    });
  });

  it("collapses two approved fields of one row into one update", async () => {
    const store = {
      curated_products: [dirtyProduct(PRODUCT_ID) as Record<string, unknown>],
    };
    const approved = approvedFrom(await scanForReview(store), () => true);
    expect(approved).toHaveLength(2);

    const calls = emptyApplyCalls();
    const result = await applyApproved(applyClient(store, calls), approved);

    expect(result.applied).toBe(2);
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]?.patch).toEqual({
      name_zh: `高${CORRECTED}保溫瓶`,
      product_description_zh: `官網有產品${CORRECTED_LINK}。`,
    });
  });
});

describe("parseManifest", () => {
  const HEADER = JSON.stringify({
    kind: "header",
    generatedAt: "2026-08-21T00:00:00.000Z",
    environment: STAGING,
  });

  function patchLine(extra: Record<string, unknown>): string {
    return JSON.stringify({
      kind: "patch",
      table: "curated_products",
      key: { id: PRODUCT_ID },
      field: "name_zh",
      before: `高${BANNED}保溫瓶`,
      after: `高${CORRECTED}保溫瓶`,
      encoding: "text",
      terms: [],
      ...extra,
    });
  }

  it("approves nothing in an unedited report", () => {
    // The safe default: reviewing is an act, and a file nobody edited says the
    // reviewer approved nothing.
    const review = parseManifest(
      [HEADER, patchLine({}), patchLine({})].join("\n"),
    );

    expect(review.totalPatches).toBe(2);
    expect(review.approved).toEqual([]);
    expect(review.environment).toEqual(STAGING);
  });

  it("takes only the lines marked approve", () => {
    const review = parseManifest(
      [HEADER, patchLine({ approve: true }), patchLine({})].join("\n"),
    );

    expect(review.totalPatches).toBe(2);
    expect(review.approved).toHaveLength(1);
    expect(review.approved[0]?.after).toBe(`高${CORRECTED}保溫瓶`);
  });

  it("refuses an approve value it does not define instead of reading it as no", () => {
    // A typo must not silently drop a patch the reviewer meant to apply.
    expect(() =>
      parseManifest([HEADER, patchLine({ approve: "yes" })].join("\n")),
    ).toThrow(/approve must be true or absent/);
  });

  it("refuses a malformed line rather than skipping it", () => {
    expect(() => parseManifest([HEADER, "{ not json"].join("\n"))).toThrow(
      /line 2: not valid JSON/,
    );
    expect(() =>
      parseManifest([HEADER, patchLine({ approve: true, key: {} })].join("\n")),
    ).toThrow(/key is empty/);
    expect(() =>
      parseManifest(
        [HEADER, patchLine({ approve: true, encoding: "yaml" })].join("\n"),
      ),
    ).toThrow(/encoding must be text or json/);
  });
});

describe("assertSameEnvironment", () => {
  it("refuses a manifest reviewed against another database", () => {
    // The failure this exists for: approve on staging, apply on production.
    const production = supabaseEnvironment(
      "https://xkcayngbttpxyibgzern.supabase.co",
    );

    expect(() => assertSameEnvironment(STAGING, production)).toThrow(
      /xwkigpvnheecihpxyvsl/,
    );
    expect(() => assertSameEnvironment(STAGING, STAGING)).not.toThrow();
  });

  it("refuses a manifest with no header at all", () => {
    expect(() => assertSameEnvironment(null, STAGING)).toThrow(/no header/);
  });
});
