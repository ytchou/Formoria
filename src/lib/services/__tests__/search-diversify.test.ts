import { describe, expect, it } from "vitest";
import {
  DIVERSITY_WINDOW,
  MAX_PER_BRAND_IN_WINDOW,
  diversifyRankedProducts,
  productFamilyKey,
} from "../search-diversify";

type Item = { id: string; brandSlug: string; brandName: string; nameZh: string };

// Default names are distinct and carry no digits, so only the brand cap can
// move them (a digit token would be stripped as an SKU code).
let nameSeq = 0;
function item(
  id: string,
  brandSlug: string,
  nameZh = `品項${String.fromCharCode(0x4e00 + nameSeq++)}`,
  brandName = brandSlug,
): Item {
  return { id, brandSlug, brandName, nameZh };
}

function order(
  items: Item[],
  opts: { query?: string; maxPerBrand?: number } = {},
): string[] {
  return diversifyRankedProducts(items, { query: "陶瓷 杯", ...opts }).map(
    (i) => items[i]!.id,
  );
}

describe("productFamilyKey", () => {
  it("strips SKU-like codes so variants share a stem", () => {
    const a = productFamilyKey(item("a", "ycct", "啵啵杯710ml"));
    const b = productFamilyKey(item("b", "ycct", "啵啵杯550ml"));
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it("collapses a name that repeats itself", () => {
    const a = productFamilyKey(item("a", "ycct", "啵啵杯710ml 啵啵杯710ml"));
    const b = productFamilyKey(item("b", "ycct", "啵啵杯"));
    expect(a).toBe(b);
  });

  it("groups names that differ only in a code or a bracketed aside", () => {
    const a = productFamilyKey(item("a", "opus", "台灣造型淺盤《島嶼拾光／原盤》TW-no02"));
    const b = productFamilyKey(item("b", "opus", "台灣造型淺盤 TW-be06"));
    expect(a).toBe(b);
  });

  it("keeps differently-worded variants apart", () => {
    const he = productFamilyKey(item("a", "opus", "台灣愛心指紋造型淺盤 TW-he12"));
    const be = productFamilyKey(item("b", "opus", "台灣黑熊造型淺盤 TW-be06"));
    expect(he).not.toBe(be);
  });

  it("scopes families to the brand", () => {
    const a = productFamilyKey(item("a", "brand-a", "托特包"));
    const b = productFamilyKey(item("b", "brand-b", "托特包"));
    expect(a).not.toBe(b);
  });

  it("keeps distinct products apart", () => {
    const a = productFamilyKey(item("a", "hmm", "Patio陶瓷濾杯"));
    const b = productFamilyKey(item("b", "hmm", "Mugr陶瓷杯"));
    expect(a).not.toBe(b);
  });
});

describe("diversifyRankedProducts", () => {
  it("returns the identity order when nothing repeats", () => {
    const items = ["a", "b", "c", "d"].map((id) => item(id, `brand-${id}`));
    expect(order(items)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not cap brands by default (MAX_PER_BRAND_IN_WINDOW is uncapped)", () => {
    expect(MAX_PER_BRAND_IN_WINDOW).toBe(Number.POSITIVE_INFINITY);
    const items = ["r1", "r2", "r3", "r4"].map((id) => item(id, "petit-madam"));
    items.push(item("x1", "robber"));
    expect(order(items)).toEqual(["r1", "r2", "r3", "r4", "x1"]);
  });

  it(`a maxPerBrand option caps a brand in the first ${DIVERSITY_WINDOW}`, () => {
    const items = [
      item("r1", "petit-madam"),
      item("r2", "petit-madam"),
      item("r3", "petit-madam"),
      item("r4", "petit-madam"),
      item("x1", "robber"),
      item("x2", "other"),
    ];
    // r3 and r4 move below the other brands but are never dropped.
    expect(order(items, { maxPerBrand: 2 })).toEqual([
      "r1", "r2", "x1", "x2", "r3", "r4",
    ]);
  });

  it("puts demoted items right after the window, ahead of lower-ranked ones", () => {
    const items = [
      item("a1", "a"),
      item("a2", "a"),
      item("a3", "a"),
      ...Array.from({ length: 10 }, (_, i) => item(`o${i}`, `brand-${i}`)),
    ];
    const ids = order(items, { maxPerBrand: 2 });
    expect(ids.slice(0, DIVERSITY_WINDOW)).toEqual([
      "a1", "a2", "o0", "o1", "o2", "o3", "o4", "o5",
    ]);
    expect(ids[DIVERSITY_WINDOW]).toBe("a3");
    expect(ids.slice(DIVERSITY_WINDOW + 1)).toEqual(["o6", "o7", "o8", "o9"]);
  });

  it("keeps one near-duplicate SKU per family in the window", () => {
    const items = [
      item("x1", "dot-design", "招財貓公仔"),
      item("no", "opus", "台灣造型淺盤《島嶼拾光／原盤》TW-no02"),
      item("be", "opus", "台灣造型淺盤 TW-be06"),
      item("x2", "singezih", "字母框木質冰箱貼"),
    ];
    expect(order(items)).toEqual(["x1", "no", "x2", "be"]);
  });

  it("caps a brand's differently-named variants when a brand cap is set", () => {
    const items = [
      item("he", "opus", "台灣愛心指紋造型淺盤 TW-he12"),
      item("no", "opus", "台灣造型淺盤《島嶼拾光／原盤》TW-no02"),
      item("be", "opus", "台灣黑熊造型淺盤 TW-be06"),
      item("x", "singezih", "字母框木質冰箱貼"),
    ];
    expect(order(items, { maxPerBrand: 2 })).toEqual(["he", "no", "x", "be"]);
  });

  it("dedupes size variants of one name", () => {
    const items = [
      item("v1", "ycct", "啵啵杯710ml"),
      item("v2", "ycct", "啵啵杯550ml"),
      item("x", "other", "陶瓷杯"),
    ];
    expect(order(items)).toEqual(["v1", "x", "v2"]);
  });

  it("exempts a brand the query names", () => {
    const items = [
      item("a1", "arozma", "複方精油 1", "AROZMA"),
      item("a2", "arozma", "複方精油 2", "AROZMA"),
      item("a3", "arozma", "香氛噴霧", "AROZMA"),
      item("x", "other"),
    ];
    // a1/a2 share a family and a3 would exceed the cap; neither rule applies.
    expect(
      diversifyRankedProducts(items, { query: "arozma", maxPerBrand: 2 }),
    ).toEqual([0, 1, 2, 3]);
  });

  it("fills an unfilled window with the demoted items in rank order", () => {
    const items = [item("a1", "a"), item("a2", "a"), item("a3", "a")];
    expect(order(items, { maxPerBrand: 2 })).toEqual(["a1", "a2", "a3"]);
  });

  it("returns a permutation of every index", () => {
    const items = Array.from({ length: 30 }, (_, i) => item(`p${i}`, `b${i % 3}`));
    const perm = diversifyRankedProducts(items, { query: "杯子", maxPerBrand: 2 });
    expect([...perm].sort((x, y) => x - y)).toEqual(items.map((_, i) => i));
  });

  it("handles an empty list", () => {
    expect(diversifyRankedProducts([], { query: "杯子" })).toEqual([]);
  });
});
