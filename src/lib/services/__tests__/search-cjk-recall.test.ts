import { describe, expect, it } from "vitest";

/**
 * DEV-1510 Task 7 — the honesty guard on the search ranking baseline.
 *
 * This file no longer queries anything. It holds the captured baseline as a
 * literal and asserts ONE thing about it: that the set of rows the backfill
 * left bit-identical is declared by hand and agrees with the captured numbers.
 * That makes a silent re-pin of a score fail here instead of dissolving into a
 * green suite.
 *
 * It does NOT detect a search regression. There is no database connection and
 * no `searchBrandPage` call, so nothing here would notice `後背包` ceasing to
 * match a brand tagged `backpacks`. That behaviour is unowned by the unit
 * suite; only a live query against a seeded corpus can assert it.
 */

/**
 * `docs/reports/2026-08-20-search-ranking-baseline.md`, captured 2026-08-19
 * 07:55:34 UTC against staging BEFORE any DEV-1510 migration landed.
 *
 * Every term returned fewer than the 12-row page size, so these are complete
 * result sets. Eight of the nine rows exist only because of the subcategory
 * arm — which is what made recall the primary signal when this file still ran
 * the query. It no longer does; the numbers survive here only as the record a
 * re-pin has to be declared against.
 *
 * `subcategoryDriven` is the baseline's own "does the subcategory arm control
 * this row?" column. `opus` ranks #1 for `金工` WITHOUT carrying that label —
 * its score comes from name/description/blurb weights this migration does not
 * touch, so it is the control, not an expansion signal.
 *
 * Two rank_score ties exist (0.151982 and 0.198206). The function breaks them
 * on `id ASC`, so the assertion compares the emitted order rather than a
 * re-sort by score.
 */
/**
 * RE-PINNED 2026-08-19 after DEV-1510 task 9's backfill
 * (`20260820130000_backfill_subcategory_slugs.sql`) actually moved the data.
 *
 * The `preBackfill` column is the ORIGINAL capture above. The scores moved for
 * three of the nine rows, and the FUNCTIONS did not change — the stored values
 * they read did. Proved by reconstructing each brand's pre-migration document
 * and re-ranking it against the same tsquery:
 *
 *   with probe (slug, term, old_subs, old_en) as (values …the corpus arrays…)
 *   select p.slug, p.term,
 *          ts_rank(b.search_vector, public.brand_search_tsquery(p.term, false)),
 *          ts_rank(
 *            public.brands_search_document(
 *              b.name, b.slug, b.category, p.old_subs, p.old_en,
 *              b.description, b.blurb_en
 *            ),
 *            public.brand_search_tsquery(p.term, false)
 *          )
 *   from probe p join public.brands b on b.slug = p.slug;
 *
 * All six probed brands reproduced their `preBackfill` score EXACTLY from the
 * pre-migration arrays. The mechanism is the weight-C `to_tsvector('english',
 * subcategories)` arm: it used to index the zh-TW label itself, so a query for
 * `陶藝` or `金工` matched that arm as well as the bigram arm. It now indexes
 * `ceramics` / `metalwork`, so only the bigram arm — fed by
 * `taxonomy_expand_subcategories` — matches. That is the intended end state:
 * `english_query_still_matches` requires the raw slug to stay indexed.
 *
 * What did NOT change, as recorded at capture time: recall (9 of 9 rows
 * returned), `search_source = 'fts'` for every row (no trgm fallback), and
 * `total_count`. Emitted ORDER moved by exactly one position, in one term:
 * `金工` swaps rows 2 and 3. None of that is asserted below any more — the
 * query that checked it is gone. It is kept as the provenance of the numbers.
 *
 * `後背包` is the control for the whole re-pin — all four rows are unchanged to
 * six decimals, which is only possible if the expansion is wired correctly.
 */
const BASELINE = [
  {
    term: "陶藝",
    rows: [
      {
        slug: "1cmhandmake",
        rankScore: 0.121585,
        preBackfill: 0.151982,
        subcategoryDriven: true,
      },
      {
        slug: "91art-studio",
        rankScore: 0.121585,
        preBackfill: 0.151982,
        subcategoryDriven: true,
      },
    ],
  },
  {
    term: "後背包",
    rows: [
      {
        slug: "kevin-mccartney",
        rankScore: 0.68677,
        preBackfill: 0.68677,
        subcategoryDriven: true,
      },
      {
        slug: "tagather-goods",
        rankScore: 0.466349,
        preBackfill: 0.466349,
        subcategoryDriven: true,
      },
      {
        slug: "74ounce",
        rankScore: 0.198206,
        preBackfill: 0.198206,
        subcategoryDriven: true,
      },
      {
        slug: "25togo",
        rankScore: 0.198206,
        preBackfill: 0.198206,
        subcategoryDriven: true,
      },
    ],
  },
  {
    term: "金工",
    rows: [
      {
        slug: "opus",
        rankScore: 0.623125,
        preBackfill: 0.623125,
        subcategoryDriven: false,
      },
      {
        slug: "yuwu-design",
        rankScore: 0.197053,
        preBackfill: 0.159454,
        subcategoryDriven: true,
      },
      {
        slug: "5am-jewelry",
        rankScore: 0.143538,
        preBackfill: 0.162536,
        subcategoryDriven: true,
      },
    ],
  },
] as const;

/**
 * The control row's score must survive a change that only touches the
 * subcategory arms — `opus` ranks #1 for 金工 without carrying the label — and
 * every unchanged-content row must too. A re-pin that moved one of these is a
 * re-pin covering up a real regression.
 *
 * Written out by hand, NOT derived from `BASELINE` with the same
 * `rankScore === preBackfill` predicate the assertions test under. A derived
 * list re-states the baseline instead of constraining it: silently re-pinning
 * one of these five would drop the row out of the derived list and out of the
 * check in the same edit, and the suite would stay green. As a literal, that
 * edit fails `baseline_re_pin_is_declared` below and has to be argued for.
 *
 * Membership is a fact about the CORPUS, not about the numbers: these are the
 * five rows whose indexed content the backfill did not change, so their score
 * is required to be bit-identical to the pre-migration capture.
 */
const UNMOVED_BY_THE_BACKFILL: readonly string[] = [
  "後背包:kevin-mccartney",
  "後背包:tagather-goods",
  "後背包:74ounce",
  "後背包:25togo",
  "金工:opus",
] as const;

/**
 * The honesty guard on the re-pin, and the reason `UNMOVED_BY_THE_BACKFILL` is a
 * literal. It needs no database, so it runs on every `pnpm test` rather than
 * only when the integration env is armed — a re-pin lands in a normal PR, not
 * in an integration run.
 */
describe("search ranking baseline", () => {
  it("baseline_re_pin_is_declared", () => {
    const unchanged = BASELINE.flatMap(({ term, rows }) =>
      rows
        .filter((row) => row.rankScore === row.preBackfill)
        .map((row) => `${term}:${row.slug}`),
    );

    // Set equality in both directions. Re-pinning `rankScore` on one of the five
    // drops it out of `unchanged` and fails the first assertion; adding a row to
    // the literal to make that pass fails the second. Either way the edit is
    // visible in review instead of dissolving into a green suite.
    expect([...unchanged].sort()).toEqual([...UNMOVED_BY_THE_BACKFILL].sort());
    expect(UNMOVED_BY_THE_BACKFILL).toHaveLength(5);

    // And every listed key names a row the baseline actually carries.
    const baselineKeys = BASELINE.flatMap(({ term, rows }) =>
      rows.map((row) => `${term}:${row.slug}`),
    );
    for (const key of UNMOVED_BY_THE_BACKFILL) {
      expect(baselineKeys, `${key} is a baseline row`).toContain(key);
    }
  });
});

