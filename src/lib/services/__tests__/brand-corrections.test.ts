import { describe, it, expect } from "vitest";

// Coupling to keep in view: `normalizeProposedValue` is pure and
// dependency-free, but importing it drags in `brand-corrections`' module scope
// (`next/cache`, the Supabase server client). The day one of those gains a
// module-scope env assertion — a pattern this repo uses elsewhere — every case
// below fails at import for reasons unrelated to what it asserts. Escape hatch
// if that happens: move the validator beside `resolveProductTagInput` in
// `product-tags.ts`, which is ontology-only imports precisely so it can be
// imported freely.
import {
  buildScalarCorrectionPatch,
  normalizeProposedValue,
} from "../brand-corrections";
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

  it("collapses case variants of one novel tag, keeping the first casing", () => {
    const value = expectOkDelta(
      normalizeTags({ add: ["Vegan", "vegan"], remove: [] }),
    );
    expect(value.add).toEqual(["Vegan"]);
  });

  it("collapses a full-width variant of one novel tag", () => {
    const value = expectOkDelta(
      normalizeTags({ add: ["vegan", "ｖｅｇａｎ"], remove: [] }),
    );
    expect(value.add).toEqual(["vegan"]);
  });

  it("rejects an emoji-only add", () => {
    // One emoji is 2 UTF-16 code units but 1 character — it must fail the
    // min-2 band exactly like a 1-character Han string does.
    expect(normalizeTags({ add: ["🧦"], remove: [] })).toEqual({
      ok: false,
      error: "invalid_value",
    });
    // Nine emoji are 9 characters (18 code units) — over the max either way,
    // but this pins the max as a code-point count, not a unit count.
    expect(normalizeTags({ add: ["🧦🧦🧦🧦🧦🧦🧦🧦🧦"], remove: [] })).toEqual({
      ok: false,
      error: "invalid_value",
    });
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

describe("normalizeProposedValue — purchase links", () => {
  it("accepts and normalizes the URL for each supported purchase destination", () => {
    expect(
      normalizeProposedValue("purchase_website", "formoria.example/shop"),
    ).toEqual({ ok: true, value: "https://formoria.example/shop" });
    expect(
      normalizeProposedValue(
        "purchase_pinkoi",
        "https://www.pinkoi.com/store/maría-garcía",
      ),
    ).toEqual({
      ok: true,
      value: "https://www.pinkoi.com/store/mar%C3%ADa-garc%C3%ADa",
    });
    expect(
      normalizeProposedValue(
        "purchase_shopee",
        "https://shopee.tw/m.garcia-test",
      ),
    ).toEqual({
      ok: true,
      value: "https://shopee.tw/m.garcia-test",
    });
  });

  it("rejects a marketplace URL submitted for the wrong destination", () => {
    expect(
      normalizeProposedValue(
        "purchase_pinkoi",
        "https://shopee.tw/m.garcia-test",
      ),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue(
        "purchase_shopee",
        "https://www.pinkoi.com/store/maría-garcía",
      ),
    ).toEqual({ ok: false, error: "invalid_value" });
  });

  it("rejects private, non-http, and oversized URLs", () => {
    expect(
      normalizeProposedValue("purchase_website", "http://127.0.0.1/shop"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("purchase_website", "http://127.0.0.2/shop"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("purchase_website", "http://[fc00::1]/shop"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("purchase_website", "http://[fe80::1]/shop"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("purchase_website", "javascript:alert(1)"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue(
        "purchase_website",
        `https://formoria.example/${"a".repeat(2048)}`,
      ),
    ).toEqual({ ok: false, error: "invalid_value" });
  });
});

describe("buildScalarCorrectionPatch — purchase links", () => {
  it.each([
    ["purchase_website", "purchaseWebsite"],
    ["purchase_pinkoi", "purchasePinkoi"],
    ["purchase_shopee", "purchaseShopee"],
  ] as const)("maps %s to %s", (field, brandField) => {
    const value = "https://shop.formoria.example/maría-garcía";
    expect(buildScalarCorrectionPatch(field, value)).toEqual({
      [brandField]: value,
    });
  });
});
