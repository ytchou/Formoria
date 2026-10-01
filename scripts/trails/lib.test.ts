import { describe, expect, it } from "vitest";

import {
  dedupeByBrandPerSection,
  isTrailEligibleProduct,
  planPlacements,
  rewriteTrailNotes,
  toPicksJson,
  validatePicks,
  type ShortlistCandidate,
  type TrailEligibilityRow,
} from "./lib";

function candidate(
  overrides: Partial<ShortlistCandidate> & {
    sectionKey: string;
    brandSlug: string;
    productKey: string;
    rank: number;
  },
): ShortlistCandidate {
  return {
    productId: `id-${overrides.brandSlug}-${overrides.productKey}`,
    name: `name ${overrides.productKey}`,
    brandName: `brand ${overrides.brandSlug}`,
    subcategory: "lamps",
    imageUrl: null,
    officialUrl: "https://example.com/p",
    ...overrides,
  };
}

describe("dedupeByBrandPerSection", () => {
  it("keeps the highest-scored product per brand within a section", () => {
    const result = dedupeByBrandPerSection([
      candidate({ sectionKey: "light", brandSlug: "kiln", productKey: "b", rank: 3 }),
      candidate({ sectionKey: "light", brandSlug: "niizo", productKey: "c", rank: 2 }),
      candidate({ sectionKey: "light", brandSlug: "kiln", productKey: "a", rank: 1 }),
    ]);

    expect(result.map((row) => [row.brandSlug, row.productKey])).toEqual([
      ["kiln", "a"],
      ["niizo", "c"],
    ]);
  });

  it("allows the same brand across sections", () => {
    const result = dedupeByBrandPerSection([
      candidate({ sectionKey: "light", brandSlug: "kiln", productKey: "a", rank: 1 }),
      candidate({ sectionKey: "cloth", brandSlug: "kiln", productKey: "b", rank: 1 }),
    ]);

    expect(result.map((row) => [row.sectionKey, row.productKey])).toEqual([
      ["light", "a"],
      ["cloth", "b"],
    ]);
  });
});

describe("toPicksJson", () => {
  it("emits { trail, sections: { key: [{ brandSlug, productKey, note }] } } from checked rows", () => {
    const picks = toPicksJson("quiet-evening", [
      { sectionKey: "light", brandSlug: "kiln", productKey: "a", note: " 暖光 ", checked: true },
      { sectionKey: "light", brandSlug: "niizo", productKey: "c", note: "", checked: false },
      { sectionKey: "cloth", brandSlug: "kiln", productKey: "b", note: "厚棉", checked: true },
      { sectionKey: "light", brandSlug: "lumen", productKey: "d", note: "可調", checked: true },
    ]);

    expect(picks).toEqual({
      trail: "quiet-evening",
      sections: {
        light: [
          { brandSlug: "kiln", productKey: "a", note: "暖光" },
          { brandSlug: "lumen", productKey: "d", note: "可調" },
        ],
        cloth: [{ brandSlug: "kiln", productKey: "b", note: "厚棉" }],
      },
    });
  });
});

describe("isTrailEligibleProduct", () => {
  const eligible: TrailEligibilityRow = {
    visible: true,
    official_url: "https://example.com/p",
    source_checked_at: "2026-09-01T00:00:00Z",
    subcategory: "lamps",
    brands: { status: "approved" },
    curated_product_sources: [{ state: "retired" }, { state: "active" }],
  };

  it("accepts an eligible product with no placement requirement", () => {
    expect(isTrailEligibleProduct(eligible)).toBe(true);
  });

  it.each([
    ["hidden", { visible: false }],
    ["no official url", { official_url: null }],
    ["never source-checked", { source_checked_at: null }],
    ["no subcategory", { subcategory: null }],
    ["unapproved brand", { brands: { status: "pending" } }],
    ["no active source", { curated_product_sources: [{ state: "retired" }] }],
    ["no source rows", { curated_product_sources: [] }],
  ] as const)("rejects a product with %s", (_label, overrides) => {
    expect(isTrailEligibleProduct({ ...eligible, ...overrides })).toBe(false);
  });
});

describe("planPlacements", () => {
  it("retires a swapped-out product before upserting its same-brand replacement", () => {
    const plan = planPlacements(
      [
        { productId: "kiln-old", sectionKey: "light", position: 0 },
        { productId: "niizo-a", sectionKey: "light", position: 1 },
      ],
      {
        light: [
          { brandSlug: "kiln", productKey: "new", note: "暖光", productId: "kiln-new" },
          { brandSlug: "niizo", productKey: "a", note: "小巧", productId: "niizo-a" },
        ],
      },
    );

    expect(plan.retire).toEqual([{ productId: "kiln-old", sectionKey: "light" }]);
    expect(plan.upsert.map((row) => row.productId)).toEqual(["kiln-new", "niizo-a"]);
  });

  it("assigns position by pick order within each section", () => {
    const plan = planPlacements([], {
      light: [
        { brandSlug: "kiln", productKey: "a", note: "一", productId: "p1" },
        { brandSlug: "niizo", productKey: "b", note: "二", productId: "p2" },
      ],
      table: [{ brandSlug: "kiln", productKey: "c", note: "三", productId: "p3" }],
    });

    expect(
      plan.upsert.map((row) => [row.sectionKey, row.productId, row.position]),
    ).toEqual([
      ["light", "p1", 0],
      ["light", "p2", 1],
      ["table", "p3", 0],
    ]);
    expect(plan.retire).toEqual([]);
  });
});

describe("validatePicks", () => {
  const pick = (brandSlug: string, productKey: string, note = "好用") => ({
    brandSlug,
    productKey,
    note,
  });

  it("rejects duplicate brands in one section, unknown section keys, and notes over 20 chars", () => {
    expect(() =>
      validatePicks(
        { trail: "t", sections: { light: [pick("kiln", "a"), pick("kiln", "b")] } },
        ["light"],
      ),
    ).toThrow(/kiln/);
    expect(() =>
      validatePicks({ trail: "t", sections: { nope: [pick("kiln", "a")] } }, ["light"]),
    ).toThrow(/nope/);
    expect(() =>
      validatePicks(
        { trail: "t", sections: { light: [pick("kiln", "a", "字".repeat(21))] } },
        ["light"],
      ),
    ).toThrow(/20/);
    expect(() =>
      validatePicks({ trail: "t", sections: { light: [pick("kiln", "a", "  ")] } }, [
        "light",
      ]),
    ).toThrow(/note/);
  });

  it("accepts the same brand in two different sections", () => {
    const picks = validatePicks(
      {
        trail: "t",
        sections: {
          light: [pick("kiln", "a", "字".repeat(20))],
          table: [pick("kiln", "b")],
        },
      },
      ["light", "table"],
    );

    expect(Object.keys(picks.sections)).toEqual(["light", "table"]);
  });
});

describe("rewriteTrailNotes", () => {
  const source = [
    "---",
    "title: 標題",
    "publishedAt: 2026-08-25",
    "sections:",
    "  - key: light",
    "    title: 光",
    "    notes:",
    "      old/gone: 舊的",
    "  - key: table",
    "    title: 桌",
    "exclusions: 無",
    "---",
    "",
    "Body stays  exactly.\n",
  ].join("\n");

  it("replaces only the notes blocks and keeps every other byte", () => {
    const result = rewriteTrailNotes(source, {
      light: {},
      table: { "kiln/a": "暖光: 小巧" },
    });

    expect(result).toBe(
      [
        "---",
        "title: 標題",
        "publishedAt: 2026-08-25",
        "sections:",
        "  - key: light",
        "    title: 光",
        "  - key: table",
        "    title: 桌",
        "    notes:",
        '      "kiln/a": "暖光: 小巧"',
        "exclusions: 無",
        "---",
        "",
        "Body stays  exactly.\n",
      ].join("\n"),
    );
  });
});
