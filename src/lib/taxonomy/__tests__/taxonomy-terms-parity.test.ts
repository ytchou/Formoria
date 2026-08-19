import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  L1_CATEGORIES,
  L2_SUBCATEGORIES,
  MATERIALS,
} from "@/lib/taxonomy/ontology";
import { describeWithDb } from "@/test/setup";
import {
  TAXONOMY_TERM_AXES,
  buildTaxonomyTermRows,
  parseTaxonomyTermsSeed,
  readTaxonomyTermsMigration,
  type TaxonomyTermRow,
} from "../../../../scripts/generate-taxonomy-terms";

/**
 * `taxonomy_terms` is the SQL mirror the search trigger expands slugs through.
 * If it drifts from `ontology.ts`, nothing raises: the slug still filters, the
 * zh-TW label just stops reaching `cjk_bigrams`, and `後背包` silently stops
 * matching a brand tagged `backpacks`.
 *
 * The gate therefore runs WITHOUT a database. It parses the committed migration
 * and compares it to the ontology module, so CI — which has no Supabase
 * credentials — still catches the drift. The live table is checked as well when
 * integration credentials are present, but that check is additive: a green CI
 * run must already mean the vocabulary agrees.
 */
function sortRows(rows: TaxonomyTermRow[]): TaxonomyTermRow[] {
  return [...rows].sort((a, b) =>
    a.axis === b.axis
      ? a.slug.localeCompare(b.slug)
      : a.axis.localeCompare(b.axis),
  );
}

const seededRows = parseTaxonomyTermsSeed(readTaxonomyTermsMigration());
const ontologyRows = buildTaxonomyTermRows();

describe("taxonomy_terms parity with the TypeScript ontology", () => {
  // Bug caught: a renamed or added ontology node that never reached the SQL
  // seed. The subcategory filter keeps working on the slug, so the only
  // symptom is a zh-TW query quietly returning fewer brands.
  it("taxonomy_terms_matches_the_typescript_ontology", () => {
    for (const category of L1_CATEGORIES) {
      const matches = seededRows.filter(
        (row) => row.axis === "l1" && row.slug === category.slug,
      );
      expect(matches, `l1:${category.slug}`).toHaveLength(1);
      expect(matches[0]).toEqual({
        axis: "l1",
        slug: category.slug,
        nameZh: category.nameZh,
        nameEn: category.name,
      });
    }

    for (const subcategory of L2_SUBCATEGORIES) {
      const matches = seededRows.filter(
        (row) => row.axis === "l2" && row.slug === subcategory.slug,
      );
      expect(matches, `l2:${subcategory.slug}`).toHaveLength(1);
      expect(matches[0]).toEqual({
        axis: "l2",
        slug: subcategory.slug,
        nameZh: subcategory.nameZh,
        nameEn: subcategory.nameEn,
      });
    }

    for (const material of MATERIALS) {
      const matches = seededRows.filter(
        (row) => row.axis === "material" && row.slug === material,
      );
      expect(matches, `material:${material}`).toHaveLength(1);
      // A material's slug IS its zh-TW term: that is what `brands.material`
      // stores and what `?material=` carries in the URL.
      expect(matches[0]?.nameZh).toBe(material);
      expect(matches[0]?.nameEn).toBeTruthy();
    }

    // No orphans: a term removed from the ontology but left in the SQL seed
    // would keep expanding into the search document forever.
    expect(sortRows(seededRows)).toEqual(sortRows(ontologyRows));
  });

  // Bug caught: an axis typo, or an L1 seeded onto the `l2` axis, which the
  // expansion join filters on. Wrong axis reads exactly like a missing row.
  it("axis_column_partitions_the_vocabulary", () => {
    for (const row of seededRows) {
      expect(TAXONOMY_TERM_AXES, `${row.axis}:${row.slug}`).toContain(row.axis);
    }

    const counts = { l1: 0, l2: 0, material: 0 };
    for (const row of seededRows) counts[row.axis] += 1;

    expect(counts).toEqual({ l1: 13, l2: 175, material: 12 });
    expect(counts.l1).toBe(L1_CATEGORIES.length);
    expect(counts.l2).toBe(L2_SUBCATEGORIES.length);
    expect(counts.material).toBe(MATERIALS.length);

    // The composite primary key is (axis, slug), not slug alone — assert the
    // pair is what is unique, so an L1 and an L2 sharing a slug stays legal.
    const keys = seededRows.map((row) => `${row.axis}:${row.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describeWithDb("taxonomy_terms as deployed", () => {
  const supabase =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
        )
      : null;

  // Bug caught: the migration applied against a database whose seed block had
  // been edited by hand, or applied before the generator was re-run.
  it("live_table_matches_the_generated_seed", async () => {
    const { data, error } = await supabase!
      .from("taxonomy_terms")
      .select("axis, slug, name_zh, name_en");
    expect(error).toBeNull();

    const live: TaxonomyTermRow[] = (data ?? []).map((row) => ({
      axis: row.axis,
      slug: row.slug,
      nameZh: row.name_zh,
      nameEn: row.name_en,
    }));
    expect(sortRows(live)).toEqual(sortRows(ontologyRows));
  });
});
