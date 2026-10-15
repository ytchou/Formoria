import { describe, expect, it } from "vitest";

import {
  applyEntries,
  buildBatchPrompt,
  checkPrecondition,
  chunk,
  entriesFromModel,
  selectMissing,
  sha256,
  type DescriptionRow,
  type ManifestEntry,
} from "../translate-descriptions-en";

/**
 * The EN description backfill (DEV-2016).
 *
 * Every decision is a pure function and the write is injected —
 * `scripts/check-test-boundaries.mjs` forbids vi.mock of `@/lib/services/` and
 * `@/lib/supabase/`, so `updateCuratedProduct` is handed in rather than mocked.
 */

const BRAND = "6b1f0c2e-8d4a-4f3b-9c7e-1a2b3c4d5e6f";

function row(overrides: Partial<DescriptionRow> = {}): DescriptionRow {
  return {
    id: "3f6c2a1b-0d54-4e19-9a77-2b5c8e1d4f30",
    brand_id: BRAND,
    name_zh: "陶土餐盤",
    name_en: "Clay Plate",
    product_description_zh: "以台南陶土手作，適合日常盛裝。",
    product_description_en: null,
    visible: true,
    brands: { slug: "island-studio" },
    ...overrides,
  };
}

function entry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  const source = row();
  return {
    id: source.id,
    brandSlug: "island-studio",
    nameZh: source.name_zh,
    nameEn: source.name_en,
    sourceZh: source.product_description_zh,
    sourceZhSha256: sha256(source.product_description_zh),
    proposedEn: "Handmade from Tainan clay, for everyday serving.",
    status: "proposed",
    exception: null,
    review: "approved",
    ...overrides,
  };
}

describe("selectMissing", () => {
  it("keeps visible rows whose EN description is null or blank", () => {
    const rows = [
      row({ id: "null-en" }),
      row({ id: "blank-en", product_description_en: "  " }),
      row({ id: "has-en", product_description_en: "Already translated." }),
      row({ id: "hidden", visible: false }),
      row({ id: "no-zh", product_description_zh: " " }),
    ];
    expect(selectMissing(rows).map((r) => r.id)).toEqual(["null-en", "blank-en"]);
  });
});

describe("buildBatchPrompt", () => {
  it("passes the zh description through unchanged", () => {
    const source = row({ product_description_zh: "第一段。\n\n第二段「引號」。" });
    const prompt = buildBatchPrompt([source]);
    const payload = JSON.parse(prompt.slice(prompt.indexOf("["))) as {
      description_zh: string;
    }[];
    expect(payload[0].description_zh).toBe(source.product_description_zh);
  });
});

describe("entriesFromModel", () => {
  it("records a proposal with the source hash and pending review", () => {
    const source = row();
    const [result] = entriesFromModel([source], {
      items: [{ id: source.id, en: "  Handmade from Tainan clay.  " }],
    });
    expect(result).toMatchObject({
      status: "proposed",
      proposedEn: "Handmade from Tainan clay.",
      sourceZh: source.product_description_zh,
      sourceZhSha256: sha256(source.product_description_zh),
      review: "pending",
      brandSlug: "island-studio",
    });
  });

  it("turns a missing, empty, model-flagged, or Han-bearing result into an exception", () => {
    const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" }), row({ id: "d" })];
    const entries = entriesFromModel(rows, {
      items: [
        { id: "b", en: "  " },
        { id: "c", exception: "source is truncated" },
        { id: "d", en: "Clay plate from 台南" },
      ],
    });
    expect(entries.map((e) => [e.id, e.status, e.exception])).toEqual([
      ["a", "exception", "model returned no result for this id"],
      ["b", "exception", "model returned an empty translation"],
      ["c", "exception", "model: source is truncated"],
      ["d", "exception", "translation contains Chinese characters"],
    ]);
  });

  it("treats a null structured output as no result for every row", () => {
    const entries = entriesFromModel([row({ id: "a" })], null);
    expect(entries[0].status).toBe("exception");
  });
});

describe("chunk", () => {
  it("splits into fixed-size batches with a short tail", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("checkPrecondition", () => {
  it("passes an approved entry against an unchanged row", () => {
    expect(checkPrecondition(entry(), row())).toBeNull();
  });

  it.each([
    ["not-approved", entry({ review: "pending" }), row()],
    ["not-approved", entry({ review: "rejected" }), row()],
    ["no-proposed-en", entry({ proposedEn: " " }), row()],
    ["row-missing", entry(), undefined],
    ["row-hidden", entry(), row({ visible: false })],
    ["en-already-set", entry(), row({ product_description_en: "Someone wrote this." })],
    ["zh-changed", entry(), row({ product_description_zh: "改過的描述。" })],
  ] as const)("skips with %s", (reason, candidate, current) => {
    expect(checkPrecondition(candidate, current)).toBe(reason);
  });

  it("lets a human-written proposal on an exception through once approved", () => {
    expect(
      checkPrecondition(
        entry({ status: "exception", exception: "model: ambiguous", proposedEn: "Edited." }),
        row(),
      ),
    ).toBeNull();
  });
});

describe("applyEntries", () => {
  const current = new Map([[row().id, row()]]);

  it("writes nothing on a dry run but reports what it would write", async () => {
    const calls: string[] = [];
    const report = await applyEntries({
      entries: [entry(), entry({ id: "gone" })],
      current,
      apply: false,
      update: async (id) => {
        calls.push(id);
      },
    });
    expect(calls).toEqual([]);
    expect(report.intended).toBe(1);
    expect(report.skipped["row-missing"]).toBe(1);
  });

  it("writes only the EN text of entries that pass, trimmed", async () => {
    const calls: [string, string][] = [];
    const report = await applyEntries({
      entries: [entry({ proposedEn: "  Trimmed.  " }), entry({ id: "x", review: "pending" })],
      current,
      apply: true,
      update: async (id, en) => {
        calls.push([id, en]);
      },
    });
    expect(calls).toEqual([[row().id, "Trimmed."]]);
    expect(report.written).toBe(1);
    expect(report.writtenBrandSlugs).toEqual(["island-studio"]);
  });

  it("carries a failed write instead of throwing", async () => {
    const report = await applyEntries({
      entries: [entry()],
      current,
      apply: true,
      update: async () => {
        throw new Error("boom");
      },
    });
    expect(report.written).toBe(0);
    expect(report.failures).toEqual([`${row().id}: boom`]);
  });
});
