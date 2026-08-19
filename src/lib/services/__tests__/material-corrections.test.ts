import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MATERIALS,
  matchSubcategory,
  subcategoryBySlug,
} from "@/lib/taxonomy/ontology";
import {
  applyMaterialDelta,
  isCorrectionField,
  isMaterialDelta,
  normalizeProposedValue,
  sameMaterialSet,
} from "../brand-corrections";
import { PRE_MIGRATION_CORPUS } from "../../../../scripts/rehearse-slug-reverse";

/**
 * DEV-1510 Task 10. The material axis becomes real: a closed CHECK on both
 * columns, a backfill derived from the still-live craft L2s, and `material` as
 * the SECOND array-valued correctable field.
 *
 * The counts below are sized against PRODUCTION — 795 approved brands — and are
 * asserted over the committed corpus rather than a live query. Staging holds
 * 104 of those brands, so a live assertion could only ever be a smaller number
 * that means nothing; its actual result (11 brands: 木 4, 織品 2, 金屬 2, 陶瓷 2,
 * 羊毛 1) is recorded in the migration header instead, so neither figure stands
 * in for the other.
 */

const MIGRATION_PATH =
  "supabase/migrations/20260820140000_material_check_and_backfill.sql";

/**
 * The mapping the migration implements, in TypeScript. Ten still-live craft L2s
 * onto eight terms; three of them share 織品, which is why the migration needs a
 * DISTINCT and this fixture needs a Set.
 *
 * `illustration-and-art` and `dried-flowers-and-floral-design` are absent on
 * purpose: they name a medium of expression, not a material the object is made
 * of, and guessing 紙 for an illustration would put a wrong fact behind a
 * public filter.
 */
const MATERIAL_BY_CRAFT_SLUG: Record<string, string> = {
  ceramics: "陶瓷",
  woodcraft: "木",
  "natural-dyeing": "織品",
  embroidery: "織品",
  "weaving-and-crochet": "織品",
  "glass-art": "玻璃",
  metalwork: "金屬",
  "bamboo-craft": "竹",
  "needle-felting": "羊毛",
  "leather-craft": "皮革",
};

function backfillPlan(): Map<string, string[]> {
  const plan = new Map<string, string[]>();
  for (const [brandSlug, labels] of Object.entries(PRE_MIGRATION_CORPUS)) {
    const materials = new Set<string>();
    for (const label of labels) {
      const node = matchSubcategory(label);
      const material = node ? MATERIAL_BY_CRAFT_SLUG[node.slug] : undefined;
      if (material) materials.add(material);
    }
    if (materials.size > 0) plan.set(brandSlug, [...materials]);
  }
  return plan;
}

describe("DEV-1510 material axis", () => {
  it("material_check_accepts_only_the_12_terms", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");

    // Both columns, not one. `curated_products.material` shipped in the same
    // DEV-1502 migration and is written by a different code path, so a CHECK on
    // `brands` alone leaves half the axis open.
    expect(migration).toContain("add constraint brands_material_check");
    expect(migration).toContain(
      "add constraint curated_products_material_check",
    );

    // `<@` is ELEMENT containment. `=` or `&&` would accept an unlisted term as
    // long as one listed term were present, which is the whole failure this
    // constraint exists to stop.
    const checkBodies = [
      ...migration.matchAll(/check \(material <@ array\[([\s\S]*?)\]::text\[\]\)/g),
    ].map((match) => match[1] ?? "");
    expect(checkBodies).toHaveLength(2);

    for (const body of checkBodies) {
      // Quoted, so 木 cannot pass on being a substring of another term, and the
      // count is exact: an extra term in one CHECK and not the other is the
      // asymmetry this whole case exists to catch.
      const quoted = [...body.matchAll(/'([^']+)'/g)].map(
        (match) => match[1] ?? "",
      );
      expect(quoted).toEqual([...MATERIALS]);
    }

    // 紙 / 石 / 藤 / 漆 have ZERO production evidence and are admitted anyway:
    // the vocabulary is a closed agreement, not a summary of the catalogue.
    const written = new Set([...backfillPlan().values()].flat());
    expect(written.size).toBe(8);
    for (const term of ["紙", "石", "藤", "漆"]) {
      expect(MATERIALS).toContain(term);
      expect(written.has(term)).toBe(false);
    }

    // The service layer holds the same closed set, so an unlisted term fails at
    // submit with `invalid_value` rather than as a 23514 at apply time.
    expect(
      normalizeProposedValue("material", { add: ["陶瓷"], remove: [] }),
    ).toEqual({ ok: true, value: { add: ["陶瓷"], remove: [] } });
    expect(
      normalizeProposedValue("material", { add: ["不明材質"], remove: [] }),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("material", { add: [], remove: ["不明材質"] }),
    ).toEqual({ ok: false, error: "invalid_value" });
  });

  it("backfill_writes_67_brands_across_8_terms", () => {
    const plan = backfillPlan();
    expect(plan.size).toBe(67);

    const distribution = new Map<string, number>();
    for (const materials of plan.values()) {
      for (const material of materials) {
        distribution.set(material, (distribution.get(material) ?? 0) + 1);
      }
    }
    expect(
      Object.fromEntries(
        [...distribution.entries()].toSorted((a, b) => b[1] - a[1]),
      ),
    ).toEqual({
      陶瓷: 29,
      木: 15,
      織品: 14,
      金屬: 7,
      玻璃: 7,
      竹: 4,
      羊毛: 3,
      皮革: 2,
    });
    expect(distribution.size).toBe(8);

    // The SQL half of the same mapping, read back out of the migration. Ten
    // rows, three of them on 織品 — the collision is what makes the DISTINCT
    // load-bearing, so a future edit that drops it fails here.
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    for (const [slug, material] of Object.entries(MATERIAL_BY_CRAFT_SLUG)) {
      expect(migration).toMatch(
        new RegExp(`\\('${slug}',\\s*'${material}',\\s*\\d+\\)`),
      );
    }
    expect(migration).toContain("select distinct on (mapping.material)");
  });

  it("craft_labels_remain_in_subcategories", () => {
    // DEV-1507 retires `crafts`; DEV-1510 only ADDS the material axis. The
    // migration must therefore write `material` and nothing else — 19 e2e files
    // seed `category: 'crafts'` and two published stories derive tags from
    // `L1_CATEGORIES`.
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    expect(migration).not.toMatch(/set\s+subcategories\s*=/);
    expect(migration).toContain(
      "brands.subcategories on: %; the craft labels stay until DEV-1507",
    );

    // The nodes the backfill reads are still live, and still under `crafts`.
    // `subcategoryBySlug`, not `matchSubcategory`: the backfill now reads the
    // SLUG column that task 9 produced, and a slug is not a key in the
    // label-matching map.
    expect(matchSubcategory("陶瓷・陶藝")?.slug).toBe("ceramics");
    for (const slug of Object.keys(MATERIAL_BY_CRAFT_SLUG)) {
      const node = subcategoryBySlug(slug);
      expect(node?.slug).toBe(slug);
      expect(node?.category).toBe("crafts");
    }
  });

  it("material_is_correctable_as_an_array_field", () => {
    expect(isCorrectionField("material")).toBe(true);
    expect(isMaterialDelta({ add: ["陶瓷"], remove: [] })).toBe(true);
    expect(isMaterialDelta({ add: "陶瓷", remove: [] })).toBe(false);

    // Applies as a DELTA over the stored array, not as a scalar replacement:
    // two visitors correcting different terms must compose, and a scalar branch
    // would make the second overwrite the first.
    expect(applyMaterialDelta(["陶瓷"], { add: ["木"], remove: [] })).toEqual([
      "陶瓷",
      "木",
    ]);
    expect(
      applyMaterialDelta(["陶瓷", "木"], { add: [], remove: ["陶瓷"] }),
    ).toEqual(["木"]);

    // Canonical MATERIALS order, not first-seen. The backfill writes that
    // order, so a corrected row and a backfilled row holding the same set have
    // to compare equal by array equality.
    expect(
      applyMaterialDelta([], { add: ["皮革", "陶瓷", "木"], remove: [] }),
    ).toEqual(["陶瓷", "木", "皮革"]);
    expect(sameMaterialSet(["木", "陶瓷"], ["陶瓷", "木"])).toBe(true);
    expect(sameMaterialSet(["木"], ["陶瓷", "木"])).toBe(false);

    // The registry the database enforces moves with it, and
    // `purchase_channel_sql_surface()` snapshots that constraint — so the
    // re-pin is proved inside the migration rather than assumed.
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    expect(migration).toContain("brand_field_corrections_field_check");
    expect(migration).toContain("purchase_channel_sql_surface()");
    expect(migration).toMatch(/'material',\s*\n\s*'purchase_website'/);
  });
});
