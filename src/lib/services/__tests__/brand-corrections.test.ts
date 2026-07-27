import { describe, it, expect } from "vitest";

import { normalizeProposedValue } from "../brand-corrections";
import type { ProductTagsDelta } from "../product-tags";

function normalizeTags(delta: unknown) {
  return normalizeProposedValue("product_tags", delta);
}

function expectOkDelta(result: ReturnType<typeof normalizeTags>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected ok result");
  return result.value as ProductTagsDelta;
}

describe("normalizeProposedValue — product_tags", () => {
  it("accepts a canonical nameZh add", () => {
    const value = expectOkDelta(normalizeTags({ add: ["洋裝"], remove: [] }));
    expect(value.add).toEqual(["洋裝"]);
    expect(value.remove).toEqual([]);
  });

  it("canonicalizes an alias add to its nameZh", () => {
    const value = expectOkDelta(normalizeTags({ add: ["T恤"], remove: [] }));
    expect(value.add).toEqual(["上衣・T恤"]);
  });

  it("canonicalizes an English-name add", () => {
    const value = expectOkDelta(
      normalizeTags({ add: ["Dresses"], remove: [] }),
    );
    expect(value.add).toEqual(["洋裝"]);
  });

  it("accepts a cross-category canonical add", () => {
    // `手工皂` is a beauty subcategory; the closed set is global, not scoped to
    // the brand's own category, so it must pass here.
    const value = expectOkDelta(normalizeTags({ add: ["手工皂"], remove: [] }));
    expect(value.add).toEqual(["手工皂"]);
  });

  it("accepts a novel add", () => {
    const value = expectOkDelta(
      normalizeTags({ add: ["手工燈籠"], remove: [] }),
    );
    expect(value.add).toEqual(["手工燈籠"]);
  });

  it("rejects an over-length add", () => {
    expect(normalizeTags({ add: ["手工玻璃吹製花瓶器"], remove: [] })).toEqual({
      ok: false,
      error: "invalid_value",
    });
  });

  it("rejects a blocklisted add", () => {
    expect(normalizeTags({ add: ["禮盒組"], remove: [] })).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeTags({ add: ["迷你花瓶"], remove: [] })).toEqual({
      ok: false,
      error: "invalid_value",
    });
  });

  it("dedupes adds that canonicalize to the same tag", () => {
    const value = expectOkDelta(
      normalizeTags({ add: ["T恤", "上衣・T恤"], remove: [] }),
    );
    expect(value.add).toEqual(["上衣・T恤"]);
  });

  it("leaves remove unrestricted", () => {
    const value = expectOkDelta(
      normalizeTags({ add: [], remove: ["超值限定組合系列", "  襪  "] }),
    );
    expect(value.remove).toEqual(["超值限定組合系列", "襪"]);
  });

  it("is idempotent", () => {
    const input = {
      add: ["洋裝", "T恤", "Dresses", "手工燈籠"],
      remove: ["禮盒組", "斜背包"],
    };
    const once = expectOkDelta(normalizeTags(input));
    const twice = expectOkDelta(normalizeTags(once));
    expect(twice).toEqual(once);
    // Guards the assertion above from passing vacuously on an empty delta.
    expect(once.add).toEqual(["洋裝", "上衣・T恤", "手工燈籠"]);
  });

  it("rejects a malformed delta", () => {
    expect(normalizeTags({ add: ["洋裝"] })).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeTags(["洋裝"])).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeTags(null)).toEqual({ ok: false, error: "invalid_value" });
    expect(normalizeTags({ add: [1], remove: [] })).toEqual({
      ok: false,
      error: "invalid_value",
    });
  });
});

describe("normalizeProposedValue — price_range and product_type", () => {
  it("price_range and product_type branches are unchanged", () => {
    expect(normalizeProposedValue("price_range", 1)).toEqual({
      ok: true,
      value: 1,
    });
    expect(normalizeProposedValue("price_range", 3)).toEqual({
      ok: true,
      value: 3,
    });
    expect(normalizeProposedValue("price_range", 0)).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeProposedValue("price_range", 4)).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeProposedValue("price_range", 2.5)).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeProposedValue("price_range", "2")).toEqual({
      ok: false,
      error: "invalid_value",
    });

    expect(normalizeProposedValue("product_type", "fashion")).toEqual({
      ok: true,
      value: "fashion",
    });
    expect(normalizeProposedValue("product_type", "not-a-slug")).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeProposedValue("product_type", 1)).toEqual({
      ok: false,
      error: "invalid_value",
    });
  });
});
