import { describe, expect, it } from "vitest";

import {
  auditBannedTerms,
  auditDuplicateDescriptions,
  auditImageResolution,
  auditParagraphing,
  auditTaxonomy,
  buildCatalogCopyReport,
  buildRefreshCohort,
  editorialRefreshSlugs,
  findBannedTerms,
  productRewriteIds,
  regenerationCommands,
  type AuditBrandRow,
  type AuditProductRow,
} from "../catalog-copy-audit";

/**
 * The DEV-1989 catalog copy audit. Every section is a pure function over
 * fixture rows; the script's Supabase reads are not exercised here
 * (`scripts/check-test-boundaries.mjs` forbids mocking them).
 */

const TAI = "\u81fa";

function brand(overrides: Partial<AuditBrandRow> = {}): AuditBrandRow {
  return {
    id: "b-1",
    slug: "island-studio",
    category: "home",
    blurb: "陶杯與花器，台南工作室手作。",
    description:
      "陶杯與花器在台南的工作室燒製。\n\nIsland Studio 的創辦人每週開窯一次。",
    description_en:
      "Island Studio makes cups and vases in Tainan.\n\nThe founder fires the kiln once a week.",
    ...overrides,
  };
}

function product(overrides: Partial<AuditProductRow> = {}): AuditProductRow {
  return {
    id: "p-1",
    brand_id: "b-1",
    name_zh: "陶杯",
    name_en: "Clay Cup",
    product_description_zh: "手捏陶杯，容量 250ml。",
    product_description_en: "A hand-pinched clay cup.",
    category: "home",
    subcategory: "tableware",
    proposed_by: "generated",
    ...overrides,
  };
}

describe("findBannedTerms", () => {
  it("flags the 以 construction and skips common compounds", () => {
    const keys = (text: string) => findBannedTerms(text).map((hit) => hit.key);

    expect(keys("以義大利植鞣牛皮製作包袋")).toEqual(["yi-construction"]);
    expect(keys("以陶土為主要材料")).toEqual(["yi-construction"]);
    // 可以 / 以及 / 以上 are not the construction.
    expect(keys("可以製作包袋")).toEqual([]);
    expect(keys("杯子以及盤子，設計簡單")).toEqual([]);
    expect(keys("三人以上製作")).toEqual([]);
  });

  it("flags each banned word, the 從 ranges and the variant tai character", () => {
    const keys = findBannedTerms(
      `結合手工，融入日常，融合工法，打造皮件，從家庭需求出發，從選料到車縫，${TAI}北。`,
    ).map((hit) => hit.key);

    expect(keys).toEqual([
      "dazao",
      "jiehe",
      "rongru",
      "ronghe",
      "cong-chufa",
      "cong-dao",
      "tai-variant",
    ]);
  });

  it("returns an excerpt around the hit", () => {
    const [hit] = findBannedTerms("這間工作室打造皮件");
    expect(hit?.excerpt).toBe("這間工作室打造皮件");
  });
});

describe("auditBannedTerms", () => {
  it("counts brands and hits per term across blurb and description", () => {
    const section = auditBannedTerms([
      brand({ id: "b-1", slug: "a", blurb: "結合木工", description: "結合金工與結合皮革" }),
      brand({ id: "b-2", slug: "b" }),
    ]);

    expect(section.brandsPerTerm.jiehe).toBe(1);
    expect(section.hitsPerTerm.jiehe).toBe(3);
    expect(section.brands.map((row) => row.slug)).toEqual(["a"]);
    expect(section.brands[0]!.hits.map((hit) => hit.field)).toEqual([
      "blurb",
      "description",
      "description",
    ]);
  });
});

describe("buildCatalogCopyReport", () => {
  it("drops products of brands outside the approved set and finds missing EN copy", () => {
    const report = buildCatalogCopyReport({
      brands: [brand()],
      products: [
        product({ id: "p-1" }),
        product({ id: "p-2", product_description_en: null, name_en: null }),
        product({ id: "p-3", product_description_en: "  ", name_en: "Plate" }),
        product({ id: "p-x", brand_id: "hidden-brand", product_description_en: null }),
        product({ id: "p-4", product_description_zh: `${TAI}灣製造的陶盤。` }),
      ],
      images: [],
    });

    expect(report.totals.visibleProducts).toBe(4);
    expect(report.missingEnglish.missingDescriptionEn).toBe(2);
    expect(report.missingEnglish.missingBoth).toBe(1);
    expect(report.missingEnglish.products).toEqual([
      { brandSlug: "island-studio", id: "p-2", nameZh: "陶杯", nameEnMissing: true },
      { brandSlug: "island-studio", id: "p-3", nameZh: "陶杯", nameEnMissing: false },
    ]);
    expect(report.missingEnglish.taiVariantNotes.map((note) => note.id)).toEqual(["p-4"]);
  });

  it("flags full-width letters and digits in stories and product copy", () => {
    const report = buildCatalogCopyReport({
      brands: [brand({ description: "以Ｃ字形縫線為記號。" })],
      products: [product({ name_zh: "臂章 ３D" })],
      images: [],
    });

    expect(report.fullWidth.map((hit) => [hit.kind, hit.field])).toEqual([
      ["brand", "description"],
      ["product", "name_zh"],
    ]);
  });
});

describe("auditDuplicateDescriptions", () => {
  it("groups identical zh notes within one brand only", () => {
    const groups = auditDuplicateDescriptions(
      [
        product({ id: "p-1", product_description_zh: "同一段描述。" }),
        product({ id: "p-2", product_description_zh: " 同一段描述。 ", proposed_by: "admin" }),
        product({ id: "p-3", brand_id: "b-2", product_description_zh: "同一段描述。" }),
      ],
      new Map([
        ["b-1", "a"],
        ["b-2", "b"],
      ]),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]!.brandSlug).toBe("a");
    expect(groups[0]!.members.map((m) => [m.id, m.generated])).toEqual([
      ["p-1", true],
      ["p-2", false],
    ]);
  });
});

describe("auditImageResolution", () => {
  it("uses the widest active image and separates unknown widths and imageless brands", () => {
    const section = auditImageResolution(
      [
        brand({ id: "b-1", slug: "small" }),
        brand({ id: "b-2", slug: "large" }),
        brand({ id: "b-3", slug: "unknown" }),
        brand({ id: "b-4", slug: "none" }),
      ],
      [
        { brand_id: "b-1", width: 390 },
        { brand_id: "b-1", width: 580 },
        { brand_id: "b-1", width: null },
        { brand_id: "b-2", width: 400 },
        { brand_id: "b-2", width: 1600 },
        { brand_id: "b-3", width: null },
      ],
    );

    expect(section.lowRes).toEqual([{ slug: "small", id: "b-1", maxWidth: 580 }]);
    expect(section.unknownWidth.map((row) => row.slug)).toEqual(["unknown"]);
    expect(section.noActiveImages.map((row) => row.slug)).toEqual(["none"]);
  });
});

describe("auditTaxonomy", () => {
  it("separates product-L1 mismatches, brand-L1 mismatches and unknown slugs", () => {
    const brands = new Map([["b-1", brand({ category: "bags-accessories" })]]);
    const section = auditTaxonomy(
      [
        // hand-tools is a home L2, product category says home: brand mismatch only.
        product({ id: "p-1", category: "home", subcategory: "hand-tools" }),
        // tops-and-tshirts is fashion, product category says bags-accessories.
        product({ id: "p-2", category: "bags-accessories", subcategory: "tops-and-tshirts" }),
        product({ id: "p-3", category: "bags-accessories", subcategory: "charms" }),
        product({ id: "p-4", category: "home", subcategory: "not-a-slug" }),
        product({ id: "p-5", subcategory: null }),
      ],
      brands,
    );

    expect(section.productCategoryMismatch.map((row) => row.id)).toEqual(["p-2"]);
    expect(section.brandCategoryMismatch.map((row) => row.id)).toEqual(["p-1", "p-2"]);
    expect(section.unknownSubcategory.map((row) => row.id)).toEqual(["p-4"]);
  });
});

describe("auditParagraphing", () => {
  it("flags single-paragraph stories, a bare subject after the lede, and long EN", () => {
    const section = auditParagraphing([
      brand({ id: "b-1", slug: "fine" }),
      brand({
        id: "b-2",
        slug: "flat",
        description: "陶杯在台南燒製。產品線包括花器與杯盤。",
        description_en: "x".repeat(650),
      }),
    ]);

    expect(section.zhSingleParagraph.map((row) => row.slug)).toEqual(["flat"]);
    expect(section.enSingleParagraph.map((row) => row.slug)).toEqual(["flat"]);
    expect(section.zhBareSubject.map((row) => row.slug)).toEqual(["flat"]);
    expect(section.enOverSoftMax).toEqual([{ slug: "flat", id: "b-2", length: 650 }]);
  });
});

describe("regeneration output", () => {
  const report = buildCatalogCopyReport({
    brands: [
      brand({ id: "b-1", slug: "zeta", blurb: "結合木工" }),
      brand({ id: "b-2", slug: "alpha", description: "一段沒有分段的故事。" }),
      brand({ id: "b-3", slug: "clean" }),
    ],
    products: [
      product({ id: "p-2", brand_id: "b-3", product_description_zh: "重複。" }),
      product({ id: "p-1", brand_id: "b-3", product_description_zh: "重複。" }),
      product({ id: "p-9", brand_id: "b-3", product_description_zh: "重複。", proposed_by: "admin" }),
    ],
    images: [{ brand_id: "b-1", width: 400 }],
  });

  it("collects editorial slugs and rewrite ids, sorted and de-duplicated", () => {
    expect(editorialRefreshSlugs(report)).toEqual(["alpha", "zeta"]);
    expect(productRewriteIds(report)).toEqual({ generated: ["p-1", "p-2"], manual: ["p-9"] });
  });

  it("prints existing commands scoped to the findings", () => {
    const lines = regenerationCommands(report, { target: "production", cohortDir: "out" });

    expect(lines).toContain(
      "pnpm curation:rerun --cohort out/catalog-copy-editorial.json --task editorial --target production --dry-run",
    );
    expect(lines).toContain(
      "pnpm exec tsx scripts/enrichment/products/curated-products/batch-populate.ts --rewrite-descriptions --ids=p-1,p-2 --target production",
    );
    expect(lines).toContain("#    --slugs=alpha,zeta");
    expect(lines.some((line) => line.includes("--ids=p-9"))).toBe(true);
  });

  it("builds a cohort whose label keys are the slugs", () => {
    expect(Object.keys(buildRefreshCohort("n", "t", ["a", "b"]).labels)).toEqual(["a", "b"]);
  });
});
