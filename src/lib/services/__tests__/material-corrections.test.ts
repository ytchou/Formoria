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
 * DEV-1510 Task 10 made `material` the SECOND array-valued correctable field,
 * with a closed CHECK on both columns and a backfill derived from the still-live
 * craft L2s. DEV-1525 then moved the axis off zh-TW labels: the column, the
 * CHECK and the corrections gate all speak SLUGS now, and 陶瓷 is a display
 * string on the `MATERIALS` entry that nothing stores or filters by.
 *
 * The counts below are sized against PRODUCTION — 795 approved brands — and are
 * asserted over the committed corpus rather than a live query. Staging holds
 * 104 of those brands, so a live assertion could only ever be a smaller number
 * that means nothing; its actual result (11 brands: wood 4, textile 2, metal 2,
 * ceramic 2, wool 1) is recorded in the backfill migration header instead, so
 * neither figure stands in for the other.
 */

const MIGRATION_PATH =
  "supabase/migrations/20260820170000_material_slugs.sql";

/** The stored vocabulary. `nameZh` / `nameEn` are display-only. */
const MATERIAL_SLUGS = MATERIALS.map((material) => material.slug);

/**
 * The mapping the backfill implements, in TypeScript — re-keyed to slugs by
 * DEV-1525. Ten still-live craft L2s onto eight terms; three of them share
 * `textile`, which is why the backfill needs a DISTINCT and this fixture needs
 * a Set.
 *
 * `illustration-and-art` and `dried-flowers-and-floral-design` are absent on
 * purpose: they name a medium of expression, not a material the object is made
 * of, and guessing `paper` for an illustration would put a wrong fact behind a
 * public filter.
 */
const MATERIAL_BY_CRAFT_SLUG: Record<string, string> = {
  ceramics: "ceramic",
  woodcraft: "wood",
  "natural-dyeing": "textile",
  embroidery: "textile",
  "weaving-and-crochet": "textile",
  "glass-art": "glass",
  metalwork: "metal",
  "bamboo-craft": "bamboo",
  "needle-felting": "wool",
  "leather-craft": "leather",
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

describe("DEV-1525 material axis", () => {
  it("material_terms_gate_accepts_slugs_only", () => {
    // The service layer holds the same closed set the column does, so an
    // unlisted term fails at submit with `invalid_value` rather than as a 23514
    // at apply time.
    expect(
      normalizeProposedValue("material", { add: ["ceramic"], remove: [] }),
    ).toEqual({ ok: true, value: { add: ["ceramic"], remove: [] } });

    // 陶瓷 is what the column stored BEFORE the slug migration, and it is now
    // exactly as invalid as a term the vocabulary never held. That is the whole
    // point of the gate: a stale admin form or a replayed payload carrying the
    // old spelling must not reach `apply_brand_patch`.
    expect(
      normalizeProposedValue("material", { add: ["陶瓷"], remove: [] }),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("material", { add: ["不明材質"], remove: [] }),
    ).toEqual({ ok: false, error: "invalid_value" });

    // `remove` is validated too — there is no legacy material value left to
    // repair, so an unlisted removal is a malformed request, not a cleanup.
    expect(
      normalizeProposedValue("material", { add: [], remove: ["陶瓷"] }),
    ).toEqual({ ok: false, error: "invalid_value" });

    // Every slug in, every display label out — asserted across the whole
    // vocabulary so a thirteenth term cannot be admitted on one side only.
    for (const material of MATERIALS) {
      expect(
        normalizeProposedValue("material", {
          add: [material.slug],
          remove: [],
        }),
      ).toEqual({ ok: true, value: { add: [material.slug], remove: [] } });
      expect(
        normalizeProposedValue("material", {
          add: [material.nameZh],
          remove: [],
        }),
      ).toEqual({ ok: false, error: "invalid_value" });
    }
  });

  it("material_delta_writes_in_canonical_order", () => {
    // Canonical `MATERIALS` order, not first-seen. The migration writes that
    // order (rank 1..12), so a corrected row and a converted row holding the
    // same set have to compare equal by array equality.
    expect(applyMaterialDelta([], { add: ["wood", "ceramic"], remove: [] })).toEqual(
      ["ceramic", "wood"],
    );
    expect(
      applyMaterialDelta([], { add: ["leather", "ceramic", "wood"], remove: [] }),
    ).toEqual(["ceramic", "wood", "leather"]);

    // Applies as a DELTA over the stored array, not as a scalar replacement:
    // two visitors correcting different terms must compose, and a scalar branch
    // would make the second overwrite the first.
    expect(applyMaterialDelta(["ceramic"], { add: ["wood"], remove: [] })).toEqual(
      ["ceramic", "wood"],
    );
    expect(
      applyMaterialDelta(["ceramic", "wood"], { add: [], remove: ["ceramic"] }),
    ).toEqual(["wood"]);

    // The rank IS the `MATERIALS` index, for all twelve — a reordering of the
    // ontology array that the sort no longer tracked would fail here.
    expect(
      applyMaterialDelta([], {
        add: [...MATERIAL_SLUGS].toReversed(),
        remove: [],
      }),
    ).toEqual(MATERIAL_SLUGS);
  });

  it("same_material_set_ignores_input_order", () => {
    // Set equality, so a proposal that merely re-orders the stored array is not
    // a change and never reaches `apply_brand_patch`.
    expect(sameMaterialSet(["ceramic", "wood"], ["wood", "ceramic"])).toBe(true);
    expect(sameMaterialSet([], [])).toBe(true);
    expect(sameMaterialSet(["wood"], ["ceramic", "wood"])).toBe(false);
    expect(sameMaterialSet(["ceramic", "wood"], ["ceramic", "glass"])).toBe(
      false,
    );
  });

  it("migration_check_matches_the_ontology", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");

    // Both columns, not one. `curated_products.material` is written by a
    // different code path, so a CHECK on `brands` alone leaves half the axis
    // open — and half of it still spelled in Chinese.
    expect(migration).toContain("add constraint brands_material_check");
    expect(migration).toContain(
      "add constraint curated_products_material_check",
    );

    // `<@` is ELEMENT containment. `=` or `&&` would accept an unlisted term as
    // long as one listed term were present, which is the whole failure this
    // constraint exists to stop.
    const checkBodies = [
      ...migration.matchAll(
        /check \(\s*material <@ array\[([\s\S]*?)\]::text\[\]\)/g,
      ),
    ].map((match) => match[1] ?? "");
    expect(checkBodies).toHaveLength(2);

    for (const body of checkBodies) {
      // Quoted, so `wood` cannot pass on being a substring of another term, and
      // the count is exact: an extra term in one CHECK and not the other is the
      // asymmetry this whole case exists to catch.
      const quoted = [...body.matchAll(/'([^']+)'/g)].map(
        (match) => match[1] ?? "",
      );
      expect(quoted).toEqual(MATERIAL_SLUGS);
    }

    // The conversion is a bijection whose rank matches the `MATERIALS` index
    // element for element. `sameMaterialSet` compares sets, but a stored order
    // that disagreed with `MATERIAL_ORDER` would make every admin diff read as
    // a pending change.
    MATERIALS.forEach((material, index) => {
      expect(migration).toMatch(
        new RegExp(
          `\\('${material.nameZh}',\\s*'${material.slug}',\\s*${index + 1}\\)`,
        ),
      );
    });

    // A vocabulary migration changes how a fact is spelled, not the fact: the
    // use axis must not move with it.
    expect(migration).not.toMatch(/set\s+subcategories\s*=/);
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
    // Same brands, same counts as the zh-keyed original — only the key changed.
    expect(
      Object.fromEntries(
        [...distribution.entries()].toSorted((a, b) => b[1] - a[1]),
      ),
    ).toEqual({
      ceramic: 29,
      wood: 15,
      textile: 14,
      metal: 7,
      glass: 7,
      bamboo: 4,
      wool: 3,
      leather: 2,
    });
    expect(distribution.size).toBe(8);

    // `paper` / `stone` / `rattan` / `lacquer` have ZERO production evidence and
    // are admitted anyway: the vocabulary is a closed agreement, not a summary
    // of the catalogue.
    const written = new Set([...distribution.keys()]);
    for (const slug of ["paper", "stone", "rattan", "lacquer"]) {
      expect(MATERIAL_SLUGS).toContain(slug);
      expect(written.has(slug)).toBe(false);
    }
  });

  it("craft_labels_remain_in_subcategories", () => {
    // The nodes the backfill read are still live, and still under `crafts`.
    // `subcategoryBySlug`, not `matchSubcategory`: `brands.subcategories` is a
    // SLUG column since DEV-1510, and a slug is not a key in the label map.
    expect(matchSubcategory("陶瓷・陶藝")?.slug).toBe("ceramics");
    for (const slug of Object.keys(MATERIAL_BY_CRAFT_SLUG)) {
      const node = subcategoryBySlug(slug);
      expect(node?.slug).toBe(slug);
      expect(node?.category).toBe("crafts");
    }
  });

  it("material_is_correctable_as_an_array_field", () => {
    expect(isCorrectionField("material")).toBe(true);
    expect(isMaterialDelta({ add: ["ceramic"], remove: [] })).toBe(true);
    expect(isMaterialDelta({ add: "ceramic", remove: [] })).toBe(false);
  });
});
