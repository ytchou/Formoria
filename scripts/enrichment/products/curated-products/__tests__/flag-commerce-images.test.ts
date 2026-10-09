import { describe, expect, it, vi } from "vitest";

import type { ImageTextSignals } from "@/lib/curated-products/commerce-text";
import {
  flagCommerceImages,
  loadFlagCandidates,
  type FlagQuery,
  type FlagRow,
} from "../flag-commerce-images";

/**
 * The commerce-image flag script (DEV-1962), which also flags ad creatives
 * (DEV-1989).
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

/** A string reads as a product-only shot carrying that text. */
function readerFor(reads: Record<string, string | ImageTextSignals>) {
  return vi.fn(
    async (_imageUrl: string, rowId: string): Promise<ImageTextSignals> => {
      const read = reads[rowId];
      if (read === undefined) throw new Error(`no text for ${rowId}`);
      return typeof read === "string"
        ? { text: read, textCoverage: 0, endorsementPerson: false }
        : read;
    },
  );
}

describe("flagCommerceImages", () => {
  it("flags the promo image and writes nothing on a dry run", async () => {
    const clearImage = vi.fn(async () => undefined);

    const report = await flagCommerceImages({
      rows: [PROMO, CLEAN],
      apply: false,
      readSignals: readerFor({
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
        imageUrl: PROMO.image_url,
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
      readSignals: readerFor({ [PROMO.id]: LAB52_TEXT, [CLEAN.id]: "" }),
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
      readSignals: readerFor({ [CLEAN.id]: "" }),
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
      readSignals: readerFor({ [PROMO.id]: LAB52_TEXT }),
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
    const readSignals = readerFor({});

    const report = await flagCommerceImages({
      rows: [row({ image_url: null })],
      apply: false,
      readSignals,
      clearImage: async () => undefined,
    });

    expect(report.skipped).toBe(1);
    expect(report.scanned).toBe(0);
    expect(readSignals).not.toHaveBeenCalled();
  });

  it("flags the three ad creatives from the staging review alongside commerce markers", async () => {
    const mask = row({ id: "mask", key: "mask", name_zh: "超導晶凍面膜 Plus" });
    const mug = row({ id: "mug", key: "mug", name_zh: "蓋賀杯" });
    const cup = row({ id: "cup", key: "cup", name_zh: "雙層吸管杯" });
    const plain = row({ id: "plain", key: "plain", name_zh: "純棉T恤" });

    const report = await flagCommerceImages({
      rows: [mask, mug, cup, plain],
      apply: false,
      readSignals: readerFor({
        mask: {
          text: "超導晶凍面膜 Plus\n品牌代言人",
          textCoverage: 0.12,
          endorsementPerson: true,
        },
        mug: {
          text: "客製圖案 一件可印\n蓋賀杯 限時",
          textCoverage: 0.1,
          endorsementPerson: false,
        },
        cup: {
          text: "可收納吸管的雙層吸管杯",
          textCoverage: 0.22,
          endorsementPerson: false,
        },
        plain: {
          text: "100% 純棉\nMIT 台灣製造",
          textCoverage: 0.05,
          endorsementPerson: false,
        },
      }),
      clearImage: async () => undefined,
    });

    expect(report.flagged.map(({ id, hits }) => ({ id, hits }))).toEqual([
      { id: "mask", hits: ["endorsement", "代言"] },
      { id: "mug", hits: ["限時", "一件可印", "客製"] },
      { id: "cup", hits: ["text-coverage"] },
    ]);
  });

  it("hands the flagged rows to onFlagged before the first clear", async () => {
    const order: string[] = [];

    await flagCommerceImages({
      rows: [PROMO, CLEAN],
      apply: true,
      readSignals: readerFor({ [PROMO.id]: LAB52_TEXT, [CLEAN.id]: "" }),
      onFlagged: async (flagged) => {
        order.push(`report:${flagged.map((entry) => entry.id).join(",")}`);
      },
      clearImage: async (rowId) => {
        order.push(`clear:${rowId}`);
      },
    });

    expect(order).toEqual([`report:${PROMO.id}`, `clear:${PROMO.id}`]);
  });

  it("clears nothing when the report cannot be written", async () => {
    const clearImage = vi.fn(async () => undefined);

    await expect(
      flagCommerceImages({
        rows: [PROMO],
        apply: true,
        readSignals: readerFor({ [PROMO.id]: LAB52_TEXT }),
        onFlagged: async () => {
          throw new Error("disk full");
        },
        clearImage,
      }),
    ).rejects.toThrow("disk full");
    expect(clearImage).not.toHaveBeenCalled();
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
