import { describe, expect, it } from "vitest";

import { subcategoryBySlug } from "@/lib/taxonomy/ontology";

import {
  assertAllowedTarget,
  foldFullWidthAlnum,
  planTaxonomyFixes,
  TAXONOMY_RULES,
  touchedBrandSlugs,
  type FixProductRow,
} from "../fix-bd2-26-taxonomy";

/**
 * The BD2-26 fix list (DEV-1989). Planning is pure; the service writes are
 * not exercised (`scripts/check-test-boundaries.mjs` forbids mocking them).
 */

function row(overrides: Partial<FixProductRow> & { slug?: string } = {}): FixProductRow {
  const { slug = "rmc", ...rest } = overrides;
  return {
    id: "p-1",
    name_zh: "刺繡臂章",
    category: "bags-accessories",
    subcategory: "charms",
    brands: { slug },
    ...rest,
  };
}

const RMC_BRAND = { id: "b-rmc", slug: "rmc", description: "以Ｃ字為記號，２０１２年創立。" };

describe("TAXONOMY_RULES", () => {
  it("targets only existing L2 slugs", () => {
    for (const rule of TAXONOMY_RULES) {
      expect(subcategoryBySlug(rule.toSubcategory), rule.toSubcategory).not.toBeNull();
      for (const from of rule.fromSubcategories) {
        expect(subcategoryBySlug(from), from).not.toBeNull();
      }
    }
  });
});

describe("planTaxonomyFixes", () => {
  it("re-files the enjoy-caster caster by exact name, within home", () => {
    const plan = planTaxonomyFixes(
      [
        row({
          id: "p-caster",
          slug: "enjoy-caster",
          name_zh: "60mm PU辦公椅腳輪",
          category: "home",
          subcategory: "hand-tools",
        }),
        row({ id: "p-other", slug: "enjoy-caster", name_zh: "螺絲起子", category: "home", subcategory: "hand-tools" }),
      ],
      RMC_BRAND,
    );

    const caster = plan.productFixes.find((fix) => fix.id === "p-caster");
    expect(caster?.after).toEqual({ category: "home", subcategory: "furniture" });
    expect(plan.productFixes.some((fix) => fix.id === "p-other")).toBe(false);
  });

  it("matches a stored name that carries a trailing model code", () => {
    const plan = planTaxonomyFixes(
      [
        row({
          id: "p-caster",
          slug: "enjoy-caster",
          name_zh: "60mm PU辦公椅腳輪 6004-23",
          category: "home",
          subcategory: "hand-tools",
        }),
        row({ id: "p-near", slug: "enjoy-caster", name_zh: "60mm PU辦公椅腳輪組", category: "home", subcategory: "hand-tools" }),
      ],
      RMC_BRAND,
    );

    expect(plan.productFixes.map((fix) => fix.id)).toContain("p-caster");
    expect(plan.productFixes.some((fix) => fix.id === "p-near")).toBe(false);
    expect(plan.notFound).not.toContain("enjoy-caster: 60mm PU辦公椅腳輪");
  });

  it("selects rmc patches by keyword only from the two wrong L2s, and the exact material names", () => {
    const plan = planTaxonomyFixes(
      [
        row({ id: "p-1", name_zh: "刺繡臂章 A", subcategory: "charms" }),
        row({ id: "p-2", name_zh: "Velcro PATCH", subcategory: "charms" }),
        row({ id: "p-3", name_zh: "立體刺繡 3D EMBROIDERY", category: "fashion", subcategory: "tops-and-tshirts" }),
        row({ id: "p-4", name_zh: "夜光材料 GLOW IN THE DARK", category: "fashion", subcategory: "tops-and-tshirts" }),
        // Keyword match but already on a different, unrelated L2: left alone.
        row({ id: "p-5", name_zh: "刺繡托特包", subcategory: "tote-bags" }),
        // Wrong L2 but no keyword: left alone.
        row({ id: "p-6", name_zh: "金屬吊飾", subcategory: "charms" }),
      ],
      RMC_BRAND,
    );

    const rmc = plan.productFixes.filter((fix) => fix.brandSlug === "rmc");
    expect(rmc.map((fix) => fix.id)).toEqual(["p-1", "p-2", "p-3", "p-4"]);
    // The L1 always follows the L2, so the service never hides the row.
    const target = subcategoryBySlug("brooches")!;
    for (const fix of rmc) {
      expect(fix.after).toEqual({ category: target.category, subcategory: "brooches" });
    }
    expect(plan.notFound).toEqual(["enjoy-caster: 60mm PU辦公椅腳輪"]);
  });

  it("reports rows already on the target and rules that match nothing", () => {
    const plan = planTaxonomyFixes(
      [
        row({
          id: "p-caster",
          slug: "enjoy-caster",
          name_zh: "60mm PU辦公椅腳輪",
          category: "home",
          subcategory: "furniture",
        }),
      ],
      null,
    );

    expect(plan.productFixes).toEqual([]);
    expect(plan.alreadyFixed.map((fixed) => fixed.id)).toEqual(["p-caster"]);
    expect(plan.notFound).toEqual([
      "rmc: 立體刺繡 3D EMBROIDERY",
      "rmc: 夜光材料 GLOW IN THE DARK",
      "rmc: no row named with 刺繡/臂章/布章/patch in charms/tops-and-tshirts",
      "rmc: brand row",
    ]);
  });

  it("folds full-width letters and digits in the rmc story", () => {
    const plan = planTaxonomyFixes([], RMC_BRAND);

    expect(plan.descriptionFix).toEqual({
      id: "b-rmc",
      slug: "rmc",
      before: RMC_BRAND.description,
      after: "以C字為記號，2012年創立。",
    });
    expect(touchedBrandSlugs(plan)).toEqual(["rmc"]);
  });

  it("plans no description fix when the story is already half-width", () => {
    const plan = planTaxonomyFixes([], { ...RMC_BRAND, description: "C 字縫線。" });
    expect(plan.descriptionFix).toBeNull();
  });
});

describe("foldFullWidthAlnum", () => {
  it("changes only full-width Latin letters and digits", () => {
    expect(foldFullWidthAlnum("ＡＢｃ１２，（）！")).toBe("ABc12，（）！");
  });
});

describe("assertAllowedTarget", () => {
  it("allows staging and an explicitly named production target", () => {
    expect(() => assertAllowedTarget("staging", [])).not.toThrow();
    expect(() => assertAllowedTarget("production", ["--target=production"])).not.toThrow();
    expect(() => assertAllowedTarget("production", ["--target", "production"])).not.toThrow();
  });

  it("refuses production that was not named", () => {
    expect(() => assertAllowedTarget("production", ["--apply"])).toThrow(/--target=production/);
  });
});
