import { describe, expect, it } from "vitest";

import {
  applyNameFixes,
  buildRollbackCsv,
  defaultRollbackCsvPath,
  planNameFixes,
  type NameRow,
  type UpdateName,
} from "../normalize-names";

/**
 * The curated-product name backfill (DEV-1962).
 *
 * The plan is pure and the write is an injected function —
 * `scripts/check-test-boundaries.mjs` forbids vi.mock of `@/lib/services/` and
 * `@/lib/supabase/`, so `updateCuratedProduct` is handed in rather than mocked.
 */

const BRAND_A = "6b1f0c2e-8d4a-4f3b-9c7e-1a2b3c4d5e6f";
const BRAND_B = "0e9d8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6b";

function row(overrides: Partial<NameRow> = {}): NameRow {
  return {
    id: "3f6c2a1b-0d54-4e19-9a77-2b5c8e1d4f30",
    brand_id: BRAND_A,
    name_zh: "陶土餐盤",
    name_en: "Clay Plate",
    visible: true,
    brands: { slug: "island-studio" },
    ...overrides,
  };
}

describe("planNameFixes", () => {
  it("strips a trailing shop SKU token", () => {
    const { fixes } = planNameFixes([
      row({ id: "a", name_zh: "Your Monkey 眼鏡架兼存錢筒 7cFSL8yz" }),
    ]);

    expect(fixes).toEqual([
      {
        id: "a",
        brandId: BRAND_A,
        brandSlug: "island-studio",
        visible: true,
        before: { nameZh: "Your Monkey 眼鏡架兼存錢筒 7cFSL8yz", nameEn: "Clay Plate" },
        after: { nameZh: "Your Monkey 眼鏡架兼存錢筒", nameEn: "Clay Plate" },
      },
    ]);
  });

  it("collapses a doubled name, in either language", () => {
    const { fixes } = planNameFixes([
      row({
        id: "b",
        name_zh: "啵啵杯710ml 啵啵杯710ml",
        name_en: "Bubble Cup Bubble Cup",
        brands: [{ slug: "island-studio" }],
      }),
    ]);

    expect(fixes).toHaveLength(1);
    expect(fixes[0]!.after).toEqual({
      nameZh: "啵啵杯710ml",
      nameEn: "Bubble Cup",
    });
    // PostgREST may embed the to-one brand as an array; the slug still reads.
    expect(fixes[0]!.brandSlug).toBe("island-studio");
  });

  it("leaves a clean row out of the plan, including one with no English name", () => {
    const { fixes, duplicateNames } = planNameFixes([
      row({ id: "c" }),
      row({ id: "d", name_zh: "行動電源 10000mAh", name_en: null }),
    ]);

    expect(fixes).toEqual([]);
    expect(duplicateNames).toEqual([]);
  });

  it("reports rows of one brand whose normalised names collide, and never merges them", () => {
    const { fixes, duplicateNames } = planNameFixes([
      row({ id: "e", name_zh: "啵啵杯710ml" }),
      row({ id: "f", name_zh: "啵啵杯710ml 7cFSL8yz", visible: false }),
      // Same name, other brand: not a duplicate.
      row({
        id: "g",
        brand_id: BRAND_B,
        name_zh: "啵啵杯710ml",
        brands: { slug: "other-brand" },
      }),
    ]);

    // Only the suffixed row is rewritten; the collision is reported, not resolved.
    expect(fixes.map((fix) => fix.id)).toEqual(["f"]);
    expect(duplicateNames).toEqual([
      {
        brandId: BRAND_A,
        brandSlug: "island-studio",
        nameZh: "啵啵杯710ml",
        members: [
          { id: "e", nameZh: "啵啵杯710ml", visible: true },
          { id: "f", nameZh: "啵啵杯710ml 7cFSL8yz", visible: false },
        ],
      },
    ]);
  });
});

describe("applyNameFixes", () => {
  function recordingUpdate(): {
    update: UpdateName;
    calls: { id: string; input: Record<string, unknown> }[];
  } {
    const calls: { id: string; input: Record<string, unknown> }[] = [];
    const update: UpdateName = async (id, input) => {
      calls.push({ id, input: { ...input } });
    };
    return { update, calls };
  }

  const { fixes } = planNameFixes([
    row({ id: "a", name_zh: "陶土餐盤 7cFSL8yz" }),
    row({
      id: "b",
      name_en: "Clay Plate Clay Plate",
      brands: { slug: "other-brand" },
    }),
  ]);

  it("writes nothing in a dry run", async () => {
    const { update, calls } = recordingUpdate();

    const report = await applyNameFixes({ fixes, apply: false, update });

    expect(calls).toEqual([]);
    expect(report).toMatchObject({ intended: 2, written: 0, failures: [] });
  });

  it("writes only the changed name through the injected update", async () => {
    const { update, calls } = recordingUpdate();

    const report = await applyNameFixes({ fixes, apply: true, update });

    expect(calls).toEqual([
      { id: "a", input: { nameZh: "陶土餐盤" } },
      { id: "b", input: { nameEn: "Clay Plate" } },
    ]);
    expect(report.written).toBe(2);
    expect(report.writtenBrandSlugs).toEqual(["island-studio", "other-brand"]);
  });

  it("counts a failed row and keeps going", async () => {
    const calls: string[] = [];
    const update: UpdateName = async (id) => {
      calls.push(id);
      if (id === "a") throw new Error("boom");
    };

    const report = await applyNameFixes({ fixes, apply: true, update });

    expect(calls).toEqual(["a", "b"]);
    expect(report.written).toBe(1);
    expect(report.failures).toEqual(["a (island-studio): boom"]);
    expect(report.writtenBrandSlugs).toEqual(["other-brand"]);
  });
});

describe("buildRollbackCsv (DEV-1989)", () => {
  it("writes one row per fix with both names before and after", () => {
    const { fixes } = planNameFixes([
      row({ id: "a", name_zh: "綁帶甜椒日・白菊姊姊 32141747", name_en: null }),
      row({
        id: "b",
        name_zh: "啵啵杯710ml 啵啵杯710ml",
        name_en: "Cup, \"Bubble\" Cup, \"Bubble\"",
        brands: null,
      }),
      row({ id: "c" }),
    ]);

    expect(buildRollbackCsv(fixes)).toBe(
      [
        "id,brand_slug,before_name_zh,before_name_en,after_name_zh,after_name_en",
        "a,island-studio,綁帶甜椒日・白菊姊姊 32141747,,綁帶甜椒日・白菊姊姊,",
        'b,,啵啵杯710ml 啵啵杯710ml,"Cup, ""Bubble"" Cup, ""Bubble""",啵啵杯710ml,"Cup, ""Bubble"""',
        "",
      ].join("\n"),
    );
  });

  it("writes only the header for an empty plan", () => {
    expect(buildRollbackCsv([])).toBe(
      "id,brand_slug,before_name_zh,before_name_en,after_name_zh,after_name_en\n",
    );
  });
});

describe("defaultRollbackCsvPath", () => {
  it("names the target and a path-safe timestamp", () => {
    expect(
      defaultRollbackCsvPath("staging", new Date("2026-10-09T01:02:03.456Z")),
    ).toBe("normalize-names-staging-2026-10-09T01-02-03.456Z.csv");
  });
});
