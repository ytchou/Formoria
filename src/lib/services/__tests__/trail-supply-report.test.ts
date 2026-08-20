import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadTrailSupplyReport,
  setTrailSupplyReportDepsForTests,
  type TrailSupplyReportDeps,
} from "../trail-supply-report";

/**
 * The report is a REPORT: it decides nothing. No case below asserts that a
 * trail was hidden, unpublished, or de-indexed, because none of that is
 * reachable from here — the trail stays indexed, in the sitemap, and on the hub
 * whatever its slate looks like
 * (docs/decisions/2026-08-20-trail-supply-decay-is-reported-not-enforced.md).
 *
 * Collaborators arrive through `setTrailSupplyReportDepsForTests`, never as
 * module mocks: `scripts/check-test-boundaries.mjs` forbids `vi.mock` of
 * `@/lib/services/*` and `@/lib/supabase/*`. That setter is the ONE seam — the
 * service used to take an overrides argument as well, and two mechanisms for
 * one job meant the route's test and this one exercised different wiring.
 */

type SelectionRow = {
  product_id: string;
  trail_slug: string;
  section_key: string;
};

/**
 * Mirrors `SELECTION_PAGE_SIZE` / `SELECTION_MAX_PAGES` in the service, which
 * are not exported. Ceiling: if either constant changes, the page arithmetic in
 * the paging cases below must change with it or they stop testing paging.
 */
const PAGE_SIZE = 500;
const MAX_PAGES = 200;

function trail(
  slug: string,
  sections: Array<{ key: string; title: string }>,
  draft = false,
) {
  return { slug, frontmatter: { draft, sections } };
}

const pilot = trail("small-space-reading-corner", [
  { key: "first", title: "先讓光進來" },
  { key: "second", title: "坐得住的位置" },
  { key: "third", title: "收得起來的秩序" },
]);

const fullSlate = async () => [
  { sectionKey: "first" },
  { sectionKey: "second" },
  { sectionKey: "third" },
];

function selection(overrides: Partial<SelectionRow> = {}): SelectionRow {
  return {
    product_id: "11111111-1111-1111-1111-111111111111",
    trail_slug: "small-space-reading-corner",
    section_key: "first",
    ...overrides,
  };
}

/**
 * Replays canned selection rows through the real paging protocol: `.range(from,
 * to)` slices, so a caller asking for a second page gets the second page and a
 * short page ends the loop exactly as PostgREST would. Pass `ranges` to observe
 * the requests. Ceiling: it does not evaluate the filters, so row-level
 * `state = 'active'` behaviour belongs against a real PostgREST, not here.
 */
function stubSelectionsClient(
  rows: SelectionRow[] | { error: Error },
  ranges: Array<[number, number]> = [],
) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    range: (from: number, to: number) => {
      ranges.push([from, to]);
      return Promise.resolve(
        Array.isArray(rows)
          ? { data: rows.slice(from, to + 1), error: null }
          : { data: null, error: rows.error },
      );
    },
  };

  return () =>
    ({ from: () => chain }) as unknown as ReturnType<
      TrailSupplyReportDeps["selectionsClient"]
    >;
}

/**
 * A read whose pages never advance: a FULL page for every range, whatever was
 * asked for. That is what an unstable order or a proxy dropping `Range` looks
 * like from here, and it is the only input that reaches the hard page cap.
 */
function unadvancingSelectionsClient(ranges: Array<[number, number]>) {
  const page = Array.from({ length: PAGE_SIZE }, (_, index) =>
    selection({ product_id: `page-row-${index}` }),
  );
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    range: (from: number, to: number) => {
      ranges.push([from, to]);
      return Promise.resolve({ data: page, error: null });
    },
  };

  return () =>
    ({ from: () => chain }) as unknown as ReturnType<
      TrailSupplyReportDeps["selectionsClient"]
    >;
}

function deps(
  overrides: Partial<TrailSupplyReportDeps> = {},
): Partial<TrailSupplyReportDeps> {
  return {
    readTrails: async () => ({ ok: true, trails: [pilot] }),
    readTrailPlacements: async () => [],
    selectionsClient: stubSelectionsClient([]),
    ...overrides,
  };
}

function run(overrides: Partial<TrailSupplyReportDeps> = {}) {
  setTrailSupplyReportDepsForTests(deps(overrides));
  return loadTrailSupplyReport();
}

function silenceConsoleError() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

type ConsoleErrorSpy = ReturnType<typeof silenceConsoleError>;

/** The `event` of every structured line the service logged. */
function loggedEvents(spy: ConsoleErrorSpy): string[] {
  return spy.mock.calls.map(([first]) => {
    if (typeof first !== "string") return "";
    const parsed: unknown = JSON.parse(first);
    return typeof parsed === "object" && parsed !== null && "event" in parsed
      ? String((parsed as { event: unknown }).event)
      : "";
  });
}

describe("loadTrailSupplyReport", () => {
  let errorSpy: ConsoleErrorSpy;

  beforeEach(() => {
    errorSpy = silenceConsoleError();
  });

  afterEach(() => {
    setTrailSupplyReportDepsForTests(null);
    errorSpy.mockRestore();
  });

  it("reports one entry per empty declared section", async () => {
    const report = await run({
      readTrailPlacements: async () => [{ sectionKey: "second" }],
    });

    expect(report.emptySections).toEqual([
      {
        trailSlug: "small-space-reading-corner",
        sectionKey: "first",
        sectionTitle: "先讓光進來",
      },
      {
        trailSlug: "small-space-reading-corner",
        sectionKey: "third",
        sectionTitle: "收得起來的秩序",
      },
    ]);
    expect(report.readUnavailable).toBe(false);
  });

  it("reports nothing for a fully supplied trail", async () => {
    const report = await run({
      readTrailPlacements: fullSlate,
      selectionsClient: stubSelectionsClient([
        selection({ section_key: "first" }),
        selection({
          product_id: "22222222-2222-2222-2222-222222222222",
          section_key: "third",
        }),
      ]),
    });

    expect(report.emptySections).toEqual([]);
    expect(report.orphanedSelections).toEqual([]);
    expect(report.readUnavailable).toBe(false);
  });

  // The nightly run checks out a branch that may carry no `content/trails/`
  // directory at all, so the trail read is the one that fails in production.
  // Every trail then reads as absent and every live selection as orphaned — an
  // orphan storm reported as the normal state. The guard is this assertion.
  it("sets read unavailable and emits nothing when the trail read fails", async () => {
    const report = await run({
      readTrails: async () => ({ ok: false, error: new Error("ENOENT") }),
      selectionsClient: stubSelectionsClient([selection()]),
    });

    expect(report).toEqual({
      readUnavailable: true,
      trailsObserved: 0,
      selectionsObserved: 0,
      emptySections: [],
      orphanedSelections: [],
    });
  });

  // `{ ok: true, trails: [] }` is what `getAllTrailsForAdmin` returns when the
  // directory exists and holds no `.mdx` — and `content/trails/.gitkeep` is
  // TRACKED, so that state survives deleting every trail file. `ok: true` alone
  // would walk the orphan storm straight through the guard: nothing is
  // declared, so every live selection diffs as `unknown_trail`.
  it("sets_read_unavailable_when_no_trails_are_declared", async () => {
    const report = await run({
      readTrails: async () => ({ ok: true, trails: [] }),
      selectionsClient: stubSelectionsClient([
        selection(),
        selection({
          product_id: "22222222-2222-2222-2222-222222222222",
          section_key: "third",
        }),
      ]),
    });

    expect(report.readUnavailable).toBe(true);
    expect(report.emptySections).toEqual([]);
    expect(report.orphanedSelections).toEqual([]);
  });

  // `curated_products` is a stub in production, where the read THROWS 42703
  // rather than returning `[]`. Zero rows would read as "every section is
  // empty", so the throw must degrade the whole report instead of decaying it.
  it("sets read unavailable when the curated read throws", async () => {
    const schemaLag = Object.assign(new Error("column does not exist"), {
      code: "42703",
    });

    const report = await run({
      readTrailPlacements: async () => {
        throw schemaLag;
      },
    });

    expect(report.readUnavailable).toBe(true);
    expect(report.emptySections).toEqual([]);
    expect(report.orphanedSelections).toEqual([]);
  });

  // Dormancy and breakage return the same report on purpose, so the log line is
  // the ONLY thing that separates "the branch has no trails" from "Supabase
  // refused the read". Without it both are invisible and identical.
  it("logs_which_read_failed_before_degrading", async () => {
    await run({
      readTrailPlacements: async () => {
        throw Object.assign(new Error("column does not exist"), {
          code: "42703",
        });
      },
    });

    expect(loggedEvents(errorSpy)).toEqual([
      "trail_supply_placement_read_failed",
    ]);
    // The Supabase error code, not its message: a PostgREST message can echo
    // row values into the deploy log.
    expect(String(errorSpy.mock.calls.at(0)?.at(0))).toContain("42703");
  });

  // `trail_slug` carries no foreign key and no CHECK, which is what makes both
  // orphan classes reachable at all.
  it("flags a selection whose trail slug matches no mdx file", async () => {
    const report = await run({
      readTrailPlacements: fullSlate,
      selectionsClient: stubSelectionsClient([
        selection({ trail_slug: "a-trail-that-was-renamed" }),
      ]),
    });

    expect(report.orphanedSelections).toEqual([
      {
        trailSlug: "a-trail-that-was-renamed",
        sectionKey: "first",
        reason: "unknown_trail",
      },
    ]);
  });

  it("flags a selection whose section key is not declared", async () => {
    const report = await run({
      readTrailPlacements: fullSlate,
      selectionsClient: stubSelectionsClient([
        selection({ section_key: "a-section-that-was-dropped" }),
      ]),
    });

    expect(report.orphanedSelections).toEqual([
      {
        trailSlug: "small-space-reading-corner",
        sectionKey: "a-section-that-was-dropped",
        reason: "undeclared_section",
      },
    ]);
  });

  // Placements are prepared before a trail is published. Reading only published
  // trails would report every one of those rows as orphaned, so the on-disk set
  // the orphan diff runs against is the ADMIN read, drafts included.
  it("does not orphan a draft trail's selections", async () => {
    const draft = trail(
      "unpublished-trail",
      [{ key: "one", title: "One" }],
      true,
    );

    const report = await run({
      readTrails: async () => ({ ok: true, trails: [pilot, draft] }),
      readTrailPlacements: fullSlate,
      selectionsClient: stubSelectionsClient([
        selection({ trail_slug: "unpublished-trail", section_key: "one" }),
      ]),
    });

    expect(report.orphanedSelections).toEqual([]);
    // The draft is never asked for a slate either: it promises nothing yet.
    expect(report.emptySections).toEqual([]);
  });

  it("counts observations when nothing is wrong", async () => {
    const report = await run({
      readTrailPlacements: fullSlate,
      selectionsClient: stubSelectionsClient([
        selection({ section_key: "first" }),
        selection({
          product_id: "22222222-2222-2222-2222-222222222222",
          section_key: "second",
        }),
      ]),
    });

    // One PUBLISHED trail examined. The count is what the empty-section pass
    // looked at, which is what makes "looked at 1 trail, found nothing"
    // distinguishable from "looked at nothing".
    expect(report.trailsObserved).toBe(1);
    expect(report.selectionsObserved).toBe(2);
    expect(report.readUnavailable).toBe(false);
  });

  // A draft-only tree is READ but never EXAMINED for a broken promise. Counting
  // the drafts would claim three observations the pass never made, which is
  // exactly the confusion `trailsObserved` exists to prevent.
  it("counts_only_the_published_trails_it_examined", async () => {
    const drafts = [
      trail("draft-one", [{ key: "one", title: "One" }], true),
      trail("draft-two", [{ key: "two", title: "Two" }], true),
    ];

    const report = await run({
      readTrails: async () => ({ ok: true, trails: [...drafts, pilot] }),
      readTrailPlacements: fullSlate,
      selectionsClient: stubSelectionsClient([selection()]),
    });

    expect(report.trailsObserved).toBe(1);
    expect(report.readUnavailable).toBe(false);
    expect(report.emptySections).toEqual([]);
    expect(report.orphanedSelections).toEqual([]);
  });

  it("counts_zero_trails_observed_for_a_draft_only_tree", async () => {
    const report = await run({
      readTrails: async () => ({
        ok: true,
        trails: [trail("draft-one", [{ key: "one", title: "One" }], true)],
      }),
      selectionsClient: stubSelectionsClient([
        selection({ trail_slug: "draft-one", section_key: "one" }),
      ]),
    });

    // Read, so not dormant — but nothing was examined for a broken promise.
    expect(report.readUnavailable).toBe(false);
    expect(report.trailsObserved).toBe(0);
    expect(report.selectionsObserved).toBe(1);
    expect(report.emptySections).toEqual([]);
  });

  // A row that never arrives is indistinguishable from a placement that does
  // not exist, so a selection read that stops at the first page publishes
  // invented decay. Only a multi-page read proves the loop advances.
  it("reads_every_page_of_selections", async () => {
    const ranges: Array<[number, number]> = [];
    const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, index) =>
      selection({ product_id: `product-${index}` }),
    );

    const report = await run({
      readTrailPlacements: fullSlate,
      selectionsClient: stubSelectionsClient(rows, ranges),
    });

    expect(report.selectionsObserved).toBe(PAGE_SIZE + 1);
    expect(ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
    ]);
    // Every row was declared, so a complete read finds no orphan. Had the tail
    // page been dropped, this stays green — which is why the range assertion
    // above is the one that matters.
    expect(report.orphanedSelections).toEqual([]);
    expect(report.readUnavailable).toBe(false);
  });

  // Pages that never advance must stop, not spin: a nightly job looping forever
  // is the worse failure. The read raises rather than returning a partial set,
  // and the report degrades to unobserved.
  it("stops_at_the_page_cap_rather_than_looping_forever", async () => {
    const ranges: Array<[number, number]> = [];

    const report = await run({
      readTrailPlacements: fullSlate,
      selectionsClient: unadvancingSelectionsClient(ranges),
    });

    expect(ranges).toHaveLength(MAX_PAGES);
    expect(report.readUnavailable).toBe(true);
    expect(report.selectionsObserved).toBe(0);
    expect(report.orphanedSelections).toEqual([]);
    expect(loggedEvents(errorSpy)).toEqual([
      "trail_supply_selection_read_failed",
    ]);
  });

  // A seam that silently fills its gaps from `PRODUCTION_DEPS` turns a partial
  // install into a LIVE Supabase call from a unit test, swallowed by the catch
  // into a green `readUnavailable: true`. It must fail, and name what is
  // missing.
  it("fails_loudly_when_the_test_seam_is_partially_installed", async () => {
    setTrailSupplyReportDepsForTests({
      readTrails: async () => ({ ok: true, trails: [pilot] }),
    });

    await expect(loadTrailSupplyReport()).rejects.toThrow(/readTrailPlacements/);
  });

  // The seam error must ESCAPE, not degrade. Both reads sit inside a `catch`
  // that returns `readUnavailable: true`, so a swallowed seam error is a test
  // that passes while asserting the wrong thing.
  it("does_not_degrade_a_seam_error_into_read_unavailable", async () => {
    setTrailSupplyReportDepsForTests({
      readTrails: async () => ({ ok: true, trails: [pilot] }),
      readTrailPlacements: fullSlate,
    });

    await expect(loadTrailSupplyReport()).rejects.toThrow(/selectionsClient/);
  });
});
