import { describe, expect, it, vi } from "vitest";

import {
  flagCommerceImages,
  loadFlagCandidates,
  type FlagQuery,
  type FlagRow,
} from "../flag-commerce-images";

/**
 * The commerce-image flag script (DEV-1962).
 *
 * Every seam is injected as an argument — `scripts/check-test-boundaries.mjs`
 * forbids vi.mock of `@/lib/services/` and `@/lib/supabase/` — so the reader
 * never calls OpenAI and the writer never touches a table.
 */

const LAB52_TEXT = "9月淨齒節 滿額最高再省$220\n贈\n$589\n原價$676";

function row(overrides: Partial<FlagRow> = {}): FlagRow {
  return {
    id: "3f6c2a1b-0d54-4e19-9a77-2b5c8e1d4f30",
    key: "kids-oral-swab",
    name_zh: "兒童口腔清潔棒",
    image_url: "/i/curated-products/brand/product/hash.webp",
    brands: { slug: "lab52" },
    ...overrides,
  };
}

const PROMO = row();
const CLEAN = row({
  id: "9a1d2c3b-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
  key: "fountain-pen",
  name_zh: "鋼筆",
  image_url: "/i/curated-products/brand/pen/hash.webp",
  brands: [{ slug: "pen-co" }],
});

function readerFor(texts: Record<string, string>) {
  return vi.fn(async (_imageUrl: string, rowId: string) => {
    const text = texts[rowId];
    if (text === undefined) throw new Error(`no text for ${rowId}`);
    return text;
  });
}

describe("flagCommerceImages", () => {
  it("flags the promo image and writes nothing on a dry run", async () => {
    const clearImage = vi.fn(async () => undefined);

    const report = await flagCommerceImages({
      rows: [PROMO, CLEAN],
      apply: false,
      readText: readerFor({
        [PROMO.id]: LAB52_TEXT,
        [CLEAN.id]: "OR-21 710ml",
      }),
      clearImage,
    });

    expect(report.selected).toBe(2);
    expect(report.scanned).toBe(2);
    expect(report.flagged).toEqual([
      {
        brandSlug: "lab52",
        id: PROMO.id,
        name: "兒童口腔清潔棒",
        hits: ["$", "省", "贈"],
      },
    ]);
    expect(report.cleared).toBe(0);
    expect(clearImage).not.toHaveBeenCalled();
  });

  it("clears only the flagged rows on --apply and reports their brands", async () => {
    const clearImage = vi.fn(async () => undefined);

    const report = await flagCommerceImages({
      rows: [PROMO, CLEAN],
      apply: true,
      readText: readerFor({ [PROMO.id]: LAB52_TEXT, [CLEAN.id]: "" }),
      clearImage,
    });

    expect(clearImage).toHaveBeenCalledTimes(1);
    expect(clearImage).toHaveBeenCalledWith(PROMO.id);
    expect(report.cleared).toBe(1);
    expect(report.clearedBrandSlugs).toEqual(["lab52"]);
  });

  it("counts an unreadable image as a failure and never clears it", async () => {
    const clearImage = vi.fn(async () => undefined);

    const report = await flagCommerceImages({
      rows: [PROMO, CLEAN],
      apply: true,
      readText: readerFor({ [CLEAN.id]: "" }),
      clearImage,
    });

    expect(report.flagged).toEqual([]);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain(PROMO.id);
    expect(clearImage).not.toHaveBeenCalled();
  });

  it("counts a failed write as a failure, not a clear", async () => {
    const report = await flagCommerceImages({
      rows: [PROMO],
      apply: true,
      readText: readerFor({ [PROMO.id]: LAB52_TEXT }),
      clearImage: async () => {
        throw new Error("write refused");
      },
    });

    expect(report.flagged).toHaveLength(1);
    expect(report.cleared).toBe(0);
    expect(report.clearedBrandSlugs).toEqual([]);
    expect(report.failures[0]).toContain("write refused");
  });

  it("skips rows with no stored image", async () => {
    const readText = readerFor({});

    const report = await flagCommerceImages({
      rows: [row({ image_url: null })],
      apply: false,
      readText,
      clearImage: async () => undefined,
    });

    expect(report.skipped).toBe(1);
    expect(report.scanned).toBe(0);
    expect(readText).not.toHaveBeenCalled();
  });
});

describe("loadFlagCandidates", () => {
  function recordingQuery() {
    const calls: {
      table: string;
      select: string[];
      eq: [string, unknown][];
      not: [string, string, unknown][];
      order: string[];
    } = { table: "", select: [], eq: [], not: [], order: [] };

    const query: FlagQuery = {
      eq(column: string, value: unknown) {
        calls.eq.push([column, value]);
        return query;
      },
      not(column: string, operator: string, value: unknown) {
        calls.not.push([column, operator, value]);
        return query;
      },
      order(column: string) {
        calls.order.push(column);
        return query;
      },
      async range() {
        return { data: [], error: null };
      },
    };

    return {
      calls,
      reader: {
        from(table: string) {
          calls.table = table;
          return {
            select: (columns: string) => {
              calls.select.push(columns);
              return query;
            },
          };
        },
      },
    };
  }

  it("reads visible rows with a stored image in a stable order", async () => {
    const { calls, reader } = recordingQuery();

    await loadFlagCandidates(null, reader);

    expect(calls.table).toBe("curated_products");
    expect(calls.eq).toEqual([["visible", true]]);
    expect(calls.not).toEqual([["image_url", "is", null]]);
    expect(calls.order).toEqual(["id"]);
  });

  it("scopes the read to one brand when --brand is given", async () => {
    const { calls, reader } = recordingQuery();

    await loadFlagCandidates("lab52", reader);

    expect(calls.eq).toContainEqual(["brands.slug", "lab52"]);
  });
});
