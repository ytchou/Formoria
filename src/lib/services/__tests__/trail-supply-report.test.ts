import { describe, expect, it } from "vitest";

import {
  loadTrailSupplyReport,
  type TrailSupplyReportDeps,
} from "../trail-supply-report";

/**
 * The report is a REPORT: it decides nothing. No case below asserts that a
 * trail was hidden, unpublished, or de-indexed, because none of that is
 * reachable from here — the trail stays indexed, in the sitemap, and on the hub
 * whatever its slate looks like
 * (docs/decisions/2026-08-20-trail-supply-decay-is-reported-not-enforced.md).
 *
 * Collaborators arrive as arguments, never as module mocks:
 * `scripts/check-test-boundaries.mjs` forbids `vi.mock` of `@/lib/services/*`
 * and `@/lib/supabase/*`, and the service takes its reads as injectable deps
 * precisely so it can be driven this way.
 */

type SelectionRow = {
  product_id: string;
  trail_slug: string;
  section_key: string;
};

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

function selection(overrides: Partial<SelectionRow> = {}): SelectionRow {
  return {
    product_id: "11111111-1111-1111-1111-111111111111",
    trail_slug: "small-space-reading-corner",
    section_key: "first",
    ...overrides,
  };
}

/**
 * Replays one canned page of selection rows and records the paging call, in the
 * shape `curated-products.test.ts` established. Ceiling: it does not evaluate
 * the filters, so row-level `state = 'active'` behaviour belongs against a real
 * PostgREST, not here.
 */
function stubSelectionsClient(rows: SelectionRow[] | { error: Error }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    range: () =>
      Promise.resolve(
        Array.isArray(rows)
          ? { data: rows, error: null }
          : { data: null, error: rows.error },
      ),
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

describe("loadTrailSupplyReport", () => {
  it("reports one entry per empty declared section", async () => {
    const report = await loadTrailSupplyReport(
      deps({
        readTrailPlacements: async () => [{ sectionKey: "second" }],
      }),
    );

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
    const report = await loadTrailSupplyReport(
      deps({
        readTrailPlacements: async () => [
          { sectionKey: "first" },
          { sectionKey: "second" },
          { sectionKey: "third" },
        ],
        selectionsClient: stubSelectionsClient([
          selection({ section_key: "first" }),
          selection({
            product_id: "22222222-2222-2222-2222-222222222222",
            section_key: "third",
          }),
        ]),
      }),
    );

    expect(report.emptySections).toEqual([]);
    expect(report.orphanedSelections).toEqual([]);
    expect(report.readUnavailable).toBe(false);
  });

  // The nightly run checks out a branch that may carry no `content/trails/`
  // directory at all, so the trail read is the one that fails in production.
  // Every trail then reads as absent and every live selection as orphaned — an
  // orphan storm reported as the normal state. The guard is this assertion.
  it("sets read unavailable and emits nothing when the trail read fails", async () => {
    const report = await loadTrailSupplyReport(
      deps({
        readTrails: async () => ({ ok: false, error: new Error("ENOENT") }),
        selectionsClient: stubSelectionsClient([selection()]),
      }),
    );

    expect(report).toEqual({
      readUnavailable: true,
      trailsObserved: 0,
      selectionsObserved: 0,
      emptySections: [],
      orphanedSelections: [],
    });
  });

  // `curated_products` is a stub in production, where the read THROWS 42703
  // rather than returning `[]`. Zero rows would read as "every section is
  // empty", so the throw must degrade the whole report instead of decaying it.
  it("sets read unavailable when the curated read throws", async () => {
    const schemaLag = Object.assign(new Error("column does not exist"), {
      code: "42703",
    });

    const report = await loadTrailSupplyReport(
      deps({
        readTrailPlacements: async () => {
          throw schemaLag;
        },
      }),
    );

    expect(report.readUnavailable).toBe(true);
    expect(report.emptySections).toEqual([]);
    expect(report.orphanedSelections).toEqual([]);
  });

  // `trail_slug` carries no foreign key and no CHECK, which is what makes both
  // orphan classes reachable at all.
  it("flags a selection whose trail slug matches no mdx file", async () => {
    const report = await loadTrailSupplyReport(
      deps({
        readTrailPlacements: async () => [
          { sectionKey: "first" },
          { sectionKey: "second" },
          { sectionKey: "third" },
        ],
        selectionsClient: stubSelectionsClient([
          selection({ trail_slug: "a-trail-that-was-renamed" }),
        ]),
      }),
    );

    expect(report.orphanedSelections).toEqual([
      {
        trailSlug: "a-trail-that-was-renamed",
        sectionKey: "first",
        reason: "unknown_trail",
      },
    ]);
  });

  it("flags a selection whose section key is not declared", async () => {
    const report = await loadTrailSupplyReport(
      deps({
        readTrailPlacements: async () => [
          { sectionKey: "first" },
          { sectionKey: "second" },
          { sectionKey: "third" },
        ],
        selectionsClient: stubSelectionsClient([
          selection({ section_key: "a-section-that-was-dropped" }),
        ]),
      }),
    );

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

    const report = await loadTrailSupplyReport(
      deps({
        readTrails: async () => ({ ok: true, trails: [pilot, draft] }),
        readTrailPlacements: async () => [
          { sectionKey: "first" },
          { sectionKey: "second" },
          { sectionKey: "third" },
        ],
        selectionsClient: stubSelectionsClient([
          selection({ trail_slug: "unpublished-trail", section_key: "one" }),
        ]),
      }),
    );

    expect(report.orphanedSelections).toEqual([]);
    // The draft is never asked for a slate either: it promises nothing yet.
    expect(report.emptySections).toEqual([]);
  });

  it("counts observations when nothing is wrong", async () => {
    const report = await loadTrailSupplyReport(
      deps({
        readTrailPlacements: async () => [
          { sectionKey: "first" },
          { sectionKey: "second" },
          { sectionKey: "third" },
        ],
        selectionsClient: stubSelectionsClient([
          selection({ section_key: "first" }),
          selection({
            product_id: "22222222-2222-2222-2222-222222222222",
            section_key: "second",
          }),
        ]),
      }),
    );

    expect(report.trailsObserved).toBe(1);
    expect(report.selectionsObserved).toBe(2);
    expect(report.readUnavailable).toBe(false);
  });
});
