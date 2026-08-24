import { describe, it, expect } from "vitest";

// Coupling to keep in view: `normalizeProposedValue` is pure and
// dependency-free, but importing it drags in `brand-corrections`' module scope
// (`next/cache`, the Supabase server client). The day one of those gains a
// module-scope env assertion — a pattern this repo uses elsewhere — every case
// below fails at import for reasons unrelated to what it asserts. Escape hatch
// if that happens: move the validator beside `resolveSubcategorySelection` in
// `subcategories.ts`, which is ontology-only imports precisely so it can be
// imported freely.
import {
  buildScalarCorrectionPatch,
  isCorrectionField,
  normalizeProposedValue,
} from "../brand-corrections";
import type { SubcategoriesDelta } from "../subcategories";

function normalizeSubcategoryDelta(delta: unknown) {
  return normalizeProposedValue("subcategories", delta);
}

function expectOkDelta(result: ReturnType<typeof normalizeSubcategoryDelta>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected ok result");
  return result.value as SubcategoriesDelta;
}

describe("normalizeProposedValue — subcategories", () => {
  it("accepts a canonical nameZh add and stores its slug", () => {
    const value = expectOkDelta(
      normalizeSubcategoryDelta({ add: ["洋裝"], remove: [] }),
    );
    expect(value.add).toEqual(["dresses"]);
    expect(value.remove).toEqual([]);
  });

  it("resolves an alias add to its slug", () => {
    const value = expectOkDelta(
      normalizeSubcategoryDelta({ add: ["T恤"], remove: [] }),
    );
    expect(value.add).toEqual(["tops-and-tshirts"]);
  });

  it("resolves an English-name add", () => {
    const value = expectOkDelta(
      normalizeSubcategoryDelta({ add: ["Dresses"], remove: [] }),
    );
    expect(value.add).toEqual(["dresses"]);
  });

  it("accepts a slug the picker already emitted, unchanged", () => {
    const value = expectOkDelta(
      normalizeSubcategoryDelta({ add: ["backpacks"], remove: [] }),
    );
    expect(value.add).toEqual(["backpacks"]);
  });

  it("accepts a cross-category add", () => {
    // `手工皂` is a beauty subcategory; the closed set is global, not scoped to
    // the brand's own category, so it must pass here.
    const value = expectOkDelta(
      normalizeSubcategoryDelta({ add: ["手工皂"], remove: [] }),
    );
    expect(value.add).toEqual(["handmade-soap"]);
  });

  // The novel escape hatch is gone (DEV-1510). A term the closed vocabulary
  // does not know is refused here as well as in the picker, because the client
  // is not the gate.
  it("rejects a term the vocabulary does not know", () => {
    expect(
      normalizeSubcategoryDelta({ add: ["手工燈籠"], remove: [] }),
    ).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(
      normalizeSubcategoryDelta({ add: ["手工玻璃吹製花瓶器"], remove: [] }),
    ).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeSubcategoryDelta({ add: ["禮盒組"], remove: [] })).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeSubcategoryDelta({ add: ["Vegan"], remove: [] })).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeSubcategoryDelta({ add: ["🧦"], remove: [] })).toEqual({
      ok: false,
      error: "invalid_value",
    });
  });

  it("dedupes adds that resolve to the same node", () => {
    const value = expectOkDelta(
      normalizeSubcategoryDelta({
        add: ["T恤", "上衣・T恤", "tops-and-tshirts"],
        remove: [],
      }),
    );
    expect(value.add).toEqual(["tops-and-tshirts"]);
  });

  it("leaves remove unrestricted", () => {
    // Removal is how a pre-migration or evicted value gets repaired, so it can
    // never be gated on the vocabulary knowing the value.
    const value = expectOkDelta(
      normalizeSubcategoryDelta({
        add: [],
        remove: ["超值限定組合系列", "  襪  "],
      }),
    );
    expect(value.remove).toEqual(["超值限定組合系列", "襪"]);
  });

  it("is idempotent", () => {
    const input = {
      add: ["洋裝", "T恤", "Dresses"],
      remove: ["禮盒組", "斜背包"],
    };
    const once = expectOkDelta(normalizeSubcategoryDelta(input));
    const twice = expectOkDelta(normalizeSubcategoryDelta(once));
    expect(twice).toEqual(once);
    // Guards the assertion above from passing vacuously on an empty delta.
    expect(once.add).toEqual(["dresses", "tops-and-tshirts"]);
  });

  it("rejects a malformed delta", () => {
    expect(normalizeSubcategoryDelta({ add: ["洋裝"] })).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeSubcategoryDelta(["洋裝"])).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeSubcategoryDelta(null)).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeSubcategoryDelta({ add: [1], remove: [] })).toEqual({
      ok: false,
      error: "invalid_value",
    });
  });
});

describe("normalizeProposedValue — category", () => {
  it("accepts known category slugs", () => {
    expect(normalizeProposedValue("category", "fashion")).toEqual({
      ok: true,
      value: "fashion",
    });
    expect(normalizeProposedValue("category", "not-a-slug")).toEqual({
      ok: false,
      error: "invalid_value",
    });
    expect(normalizeProposedValue("category", 1)).toEqual({
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

describe("normalizeProposedValue — social links", () => {
  it("accepts a URL on each social destination's own host", () => {
    expect(
      normalizeProposedValue(
        "social_instagram",
        "https://www.instagram.com/m.garcia",
      ),
    ).toEqual({ ok: true, value: "https://www.instagram.com/m.garcia" });
    expect(
      normalizeProposedValue("social_threads", "https://threads.net/@m.garcia"),
    ).toEqual({ ok: true, value: "https://threads.net/@m.garcia" });
    expect(
      normalizeProposedValue(
        "social_facebook",
        "https://www.facebook.com/m.garcia",
      ),
    ).toEqual({ ok: true, value: "https://www.facebook.com/m.garcia" });
  });

  it("accepts threads.com alongside threads.net", () => {
    expect(
      normalizeProposedValue("social_threads", "https://www.threads.com/@foo"),
    ).toEqual({ ok: true, value: "https://www.threads.com/@foo" });
  });

  it("rejects a social URL submitted for a different social field", () => {
    // The handle helpers pass any existing http(s) URL straight through, so
    // these only fail because of the explicit host check.
    expect(
      normalizeProposedValue("social_instagram", "https://threads.net/@foo"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("social_instagram", "https://facebook.com/foo"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("social_threads", "https://instagram.com/foo"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("social_threads", "https://facebook.com/foo"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("social_facebook", "https://instagram.com/foo"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("social_facebook", "https://threads.net/@foo"),
    ).toEqual({ ok: false, error: "invalid_value" });
  });

  it("rejects a URL on an unrelated host", () => {
    expect(
      normalizeProposedValue(
        "social_instagram",
        "https://formoria.example/foo",
      ),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("social_threads", "https://formoria.example/foo"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("social_facebook", "https://formoria.example/foo"),
    ).toEqual({ ok: false, error: "invalid_value" });
  });

  it("expands bare handles to the canonical profile URL", () => {
    expect(normalizeProposedValue("social_instagram", "@foo")).toEqual({
      ok: true,
      value: "https://instagram.com/foo",
    });
    expect(normalizeProposedValue("social_instagram", "foo")).toEqual({
      ok: true,
      value: "https://instagram.com/foo",
    });
    expect(normalizeProposedValue("social_threads", "@foo")).toEqual({
      ok: true,
      value: "https://threads.net/@foo",
    });
    expect(normalizeProposedValue("social_threads", "foo")).toEqual({
      ok: true,
      value: "https://threads.net/@foo",
    });
  });

  it("rejects private, credentialed, non-http, and oversized URLs", () => {
    expect(
      normalizeProposedValue("social_instagram", "http://127.0.0.1/foo"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("social_threads", "http://[::1]/@foo"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("social_facebook", "http://192.168.1.4/foo"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue(
        "social_instagram",
        "https://user:pw@instagram.com/foo",
      ),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("social_instagram", "javascript:alert(1)"),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue(
        "social_instagram",
        `https://instagram.com/${"a".repeat(2048)}`,
      ),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(normalizeProposedValue("social_instagram", 42)).toEqual({
      ok: false,
      error: "invalid_value",
    });
  });

  it("is idempotent for every social field", () => {
    const cases = [
      ["social_instagram", "@foo"],
      ["social_instagram", "https://www.instagram.com/m.garcía"],
      ["social_threads", "foo"],
      ["social_threads", "https://www.threads.com/@m.garcía"],
      ["social_facebook", "facebook.com/m.garcía"],
    ] as const;

    for (const [field, input] of cases) {
      const once = normalizeProposedValue(field, input);
      expect(once.ok).toBe(true);
      if (!once.ok) throw new Error(`expected ok result for ${field}`);
      const twice = normalizeProposedValue(field, once.value);
      expect(twice).toEqual(once);
    }
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

describe("buildScalarCorrectionPatch — social links", () => {
  it.each([
    ["social_instagram", "socialInstagram"],
    ["social_threads", "socialThreads"],
    ["social_facebook", "socialFacebook"],
  ] as const)("maps %s to %s", (field, brandField) => {
    const value = "https://instagram.com/m.garcia";
    expect(buildScalarCorrectionPatch(field, value)).toEqual({
      [brandField]: value,
    });
  });
});

describe("isCorrectionField", () => {
  it("accepts every supported field name and rejects unknown ones", () => {
    for (const field of [
      "category",
      "subcategories",
      "purchase_website",
      "purchase_pinkoi",
      "purchase_shopee",
      "social_instagram",
      "social_threads",
      "social_facebook",
    ]) {
      expect(isCorrectionField(field)).toBe(true);
    }

    expect(isCorrectionField("social_twitter")).toBe(false);
    expect(isCorrectionField("socialInstagram")).toBe(false);
    expect(isCorrectionField("")).toBe(false);
  });
});
