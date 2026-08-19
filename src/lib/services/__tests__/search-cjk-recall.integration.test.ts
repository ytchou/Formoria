import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { describeWithDb } from "@/test/setup";

/**
 * DEV-1510 Task 7. `brands.subcategories` becomes English slugs, so the
 * `cjk_bigrams` weight-C arm of `brands_search_document` loses every zh-TW
 * token it used to index. `20260820110000_search_expands_slugs.sql` expands
 * each stored slug back to `taxonomy_terms.name_zh` before tokenising.
 *
 * Nothing else in the suite asserts a search weight, so this file is the only
 * detector: without it, `後背包` silently stops matching a brand tagged
 * `backpacks` while the `?sub=backpacks` filter keeps working perfectly.
 *
 * Run scoped. `ranking_matches_the_baseline` compares against a whole-corpus
 * capture, and other integration files seed approved non-demo brands; those
 * are filtered out by name below, but a scoped run is what the plan's
 * verification step specifies.
 */

const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      )
    : null;

/**
 * `docs/reports/2026-08-20-search-ranking-baseline.md`, captured 2026-08-19
 * 07:55:34 UTC against staging BEFORE any DEV-1510 migration landed.
 *
 * Every term returned fewer than the 12-row page size, so these are complete
 * result sets and `total_count` equals the row count. That is why RECALL, not
 * rank drift, is the primary signal: eight of the nine rows exist only because
 * of the subcategory arm, and a mis-wired expansion makes them vanish rather
 * than move.
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
const BASELINE = [
  {
    term: "陶藝",
    rows: [
      { slug: "1cmhandmake", rankScore: 0.151982, subcategoryDriven: true },
      { slug: "91art-studio", rankScore: 0.151982, subcategoryDriven: true },
    ],
  },
  {
    term: "後背包",
    rows: [
      { slug: "kevin-mccartney", rankScore: 0.68677, subcategoryDriven: true },
      { slug: "tagather-goods", rankScore: 0.466349, subcategoryDriven: true },
      { slug: "74ounce", rankScore: 0.198206, subcategoryDriven: true },
      { slug: "25togo", rankScore: 0.198206, subcategoryDriven: true },
    ],
  },
  {
    term: "金工",
    rows: [
      { slug: "opus", rankScore: 0.623125, subcategoryDriven: false },
      { slug: "5am-jewelry", rankScore: 0.162536, subcategoryDriven: true },
      { slug: "yuwu-design", rankScore: 0.159454, subcategoryDriven: true },
    ],
  },
] as const;

/** Brands seeded by an integration or e2e run are not part of the corpus. */
const SEEDED_BRAND_NAME = /^DEV-\d+ |\[E2E-TEST\]/;

type SearchRow = {
  id: string;
  rankScore: number;
  searchSource: string;
  totalCount: number;
  slug: string;
  name: string;
};

async function searchBrandPage(term: string): Promise<SearchRow[]> {
  const { data, error } = await supabase!.rpc("search_brand_page", {
    search_query: term,
  });
  expect(error, term).toBeNull();

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: brands, error: brandsError } = await supabase!
    .from("brands")
    .select("id, slug, name")
    .in(
      "id",
      rows.map((row) => row.id),
    );
  expect(brandsError, term).toBeNull();

  const bySlug = new Map(
    (brands ?? []).map((brand) => [
      brand.id,
      { slug: brand.slug, name: brand.name },
    ]),
  );

  // PostgREST preserves the RPC's own row order, and search_brand_page ends on
  // `ORDER BY numbered.row_number` — so this is the function's emitted order,
  // the same thing `WITH ORDINALITY` pinned when the baseline was captured.
  return rows.map((row) => {
    const brand = bySlug.get(row.id);
    return {
      id: row.id,
      rankScore: row.rank_score,
      searchSource: row.search_source,
      totalCount: Number(row.total_count),
      slug: brand?.slug ?? row.id,
      name: brand?.name ?? "",
    };
  });
}

describeWithDb("search recall after slug storage", () => {
  /**
   * Inserts an approved, non-demo brand, runs the assertions, and removes it
   * again whatever happens. Seeding in a `beforeAll` instead would leave the
   * brand in the corpus while `ranking_matches_the_baseline` runs, and a
   * `backpacks`-tagged brand expands to `後背包` — it would join that term's
   * result set and break the row count it is supposed to be protecting.
   */
  async function withSlugTaggedBrand(
    assertions: (brandId: string) => Promise<void>,
  ): Promise<void> {
    const id = randomUUID();
    const suffix = id.slice(0, 8);
    const { error } = await supabase!.from("brands").insert({
      id,
      // Deliberately carries neither `backpack` nor 後背包: if the name matched,
      // both cases would pass on the weight-A arm and prove nothing about the
      // subcategory expansion.
      name: `DEV-1510 Recall Fixture ${suffix}`,
      slug: `dev-1510-recall-${suffix}`,
      status: "approved",
      approved_at: new Date().toISOString(),
      is_demo: false,
      category: "bags-accessories",
      subcategories: ["backpacks"],
      subcategories_en: ["Backpacks"],
    });
    expect(error).toBeNull();

    try {
      await assertions(id);
    } finally {
      const { error: cleanupError } = await supabase!
        .from("brands")
        .delete()
        .eq("id", id);
      expect(cleanupError).toBeNull();
    }
  }

  // Bug caught: slug storage starves the cjk_bigrams arm. Without the
  // taxonomy_terms expansion this returns the four label-tagged brands and
  // not the slug-tagged one — a silent recall hole, because `?sub=backpacks`
  // still finds it.
  it("cjk_query_matches_a_slug_stored_brand", async () => {
    await withSlugTaggedBrand(async (brandId) => {
      const rows = await searchBrandPage("後背包");
      expect(rows.map((row) => row.id)).toContain(brandId);

      const hit = rows.find((row) => row.id === brandId);
      // A trgm fall-through would mask a dead FTS arm, and the CJK gate in
      // search_brand_page means trgm cannot even fire for this query.
      expect(hit?.searchSource).toBe("fts");
    });
  });

  // Bug caught: expanding the ENGLISH arm to zh-TW labels as well, which would
  // trade the CJK hole for a Latin one. The raw slug must stay indexed.
  it("english_query_still_matches", async () => {
    await withSlugTaggedBrand(async (brandId) => {
      const rows = await searchBrandPage("backpack");
      expect(rows.map((row) => row.id)).toContain(brandId);
      expect(rows.find((row) => row.id === brandId)?.searchSource).toBe("fts");
    });
  });

  // Bug caught: an expansion that changes term frequencies (unioning the raw
  // and expanded arrays, or de-duplicating) moves every rank_score while every
  // row still comes back — the failure mode the baseline exists to catch.
  it("ranking_matches_the_baseline", async () => {
    for (const { term, rows: expected } of BASELINE) {
      const returned = (await searchBrandPage(term)).filter(
        (row) => !SEEDED_BRAND_NAME.test(row.name),
      );

      // Recall first. Eight of the nine baseline rows exist only through the
      // subcategory arm, so a missing slug is a hard fail, not rank drift.
      expect(
        returned.map((row) => row.slug),
        `${term}: recall and emitted order`,
      ).toEqual(expected.map((row) => row.slug));

      for (const [index, row] of returned.entries()) {
        const baselineRow = expected[index];
        // The strictest single check: a drop to `trgm` means the FTS arm
        // stopped matching and the trigram fallback is hiding it.
        expect(row.searchSource, `${term}: ${row.slug} search_source`).toBe(
          "fts",
        );
        expect(row.rankScore, `${term}: ${row.slug} rank_score`).toBeCloseTo(
          baselineRow!.rankScore,
          5,
        );
      }

      expect(returned.length, `${term}: total_count`).toBe(expected.length);
      for (const row of returned) {
        expect(row.totalCount, `${term}: total_count`).toBeGreaterThanOrEqual(
          expected.length,
        );
      }

      // The control: `opus` ranks #1 for 金工 without carrying the label, so
      // it must survive a change that only touches the subcategory arms.
      const controls = expected.filter((row) => !row.subcategoryDriven);
      for (const control of controls) {
        expect(
          returned.map((row) => row.slug),
          `${term}: control row`,
        ).toContain(control.slug);
      }
    }
  });
});
