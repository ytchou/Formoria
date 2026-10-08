import { describe, expect, it } from "vitest";

import { isShopSkuToken, normalizeCuratedProductName } from "../product-name";
import catalog from "./fixtures/catalog-names-2026-10-08.json";

describe("isShopSkuToken", () => {
  it.each(["7cFSL8yz", "zJJGtwgx", "QJVtWFVy", "q2wz7ii6", "AuCXmkNG", "998twnrh", "mvgmaaE5"])(
    "flags the random token %s",
    (token) => {
      expect(isShopSkuToken(token)).toBe(true);
    },
  );

  it.each([
    "CHECK350",
    "DKGP1013",
    "A5210009",
    "32020832",
    "Chamonix",
    "Thompson",
    "Notebook",
    "iPadMini",
    "iPhone15",
    "Type2024",
    "10000mAh",
    "notebook",
  ])("keeps the name-shaped token %s", (token) => {
    expect(isShopSkuToken(token)).toBe(false);
  });

  it("only considers 8-character alphanumeric tokens", () => {
    expect(isShopSkuToken("OR-21")).toBe(false);
    expect(isShopSkuToken("710ml")).toBe(false);
    expect(isShopSkuToken("7cFSL8yz9")).toBe(false);
  });
});

describe("normalizeCuratedProductName", () => {
  it("strips a trailing shop SKU token", () => {
    expect(normalizeCuratedProductName("Your Monkey 眼鏡架兼存錢筒 7cFSL8yz")).toBe(
      "Your Monkey 眼鏡架兼存錢筒",
    );
    expect(normalizeCuratedProductName("Handscript 手稿藝術家系列鋼珠筆 zJJGtwgx")).toBe(
      "Handscript 手稿藝術家系列鋼珠筆",
    );
    expect(normalizeCuratedProductName("小直角書籤-鯨落 q2wz7ii6")).toBe("小直角書籤-鯨落");
  });

  it("collapses a name written twice", () => {
    expect(normalizeCuratedProductName("啵啵杯710ml 啵啵杯710ml")).toBe("啵啵杯710ml");
    expect(normalizeCuratedProductName("T Torch T Torch")).toBe("T Torch");
  });

  it("collapses a name written more than twice to one copy", () => {
    expect(normalizeCuratedProductName("T Torch T Torch T Torch")).toBe("T Torch");
    expect(
      normalizeCuratedProductName("啵啵杯710ml 啵啵杯710ml 啵啵杯710ml 啵啵杯710ml"),
    ).toBe("啵啵杯710ml");
  });

  it("keeps a single Latin word said twice, which is the name itself", () => {
    expect(normalizeCuratedProductName("Bloom Bloom")).toBe("Bloom Bloom");
    expect(normalizeCuratedProductName("Bloom Bloom 造型貼紙卷")).toBe("Bloom Bloom 造型貼紙卷");
  });

  it("handles both defects on one name", () => {
    expect(normalizeCuratedProductName("啵啵杯710ml 啵啵杯710ml 7cFSL8yz")).toBe("啵啵杯710ml");
  });

  it("keeps real model names and units", () => {
    expect(normalizeCuratedProductName("鋼筆 OR-21")).toBe("鋼筆 OR-21");
    expect(normalizeCuratedProductName("啵啵杯710ml")).toBe("啵啵杯710ml");
    expect(normalizeCuratedProductName("經典條紋美麗諾羊毛毯 CHECK350")).toBe(
      "經典條紋美麗諾羊毛毯 CHECK350",
    );
    expect(normalizeCuratedProductName("夏慕尼沙發 Chamonix")).toBe("夏慕尼沙發 Chamonix");
  });

  it("never empties a name that is only a token", () => {
    expect(normalizeCuratedProductName("7cFSL8yz")).toBe("7cFSL8yz");
  });

  it("is idempotent", () => {
    const once = normalizeCuratedProductName("Your Monkey 眼鏡架兼存錢筒 7cFSL8yz");
    expect(normalizeCuratedProductName(once)).toBe(once);
  });
});

/**
 * Guard over the real catalog (DS-03): the 2026-10-08 scan counted 173 SKU
 * names and 5 doubled names. A change to the heuristic that drifts from that
 * count, or that leaves either pattern behind, fails here.
 */
describe("catalog guard (2026-10-08 scan)", () => {
  const trailingToken = /\s+[A-Za-z0-9]{8}$/;

  it("strips exactly the 173 SKU-suffixed names the review counted", () => {
    const changed = catalog.trailingTokenNames.filter(
      (name) => normalizeCuratedProductName(name) !== name,
    );
    expect(changed).toHaveLength(173);
  });

  it("leaves no stripped name still ending in a SKU token", () => {
    for (const name of catalog.trailingTokenNames) {
      const normalized = normalizeCuratedProductName(name);
      const token = trailingToken.exec(normalized)?.[0]?.trim();
      if (token) expect(isShopSkuToken(token), normalized).toBe(false);
    }
  });

  it("collapses every doubled name", () => {
    expect(catalog.doubledNames).toHaveLength(5);
    for (const name of catalog.doubledNames) {
      const normalized = normalizeCuratedProductName(name);
      expect(normalized.length, name).toBeLessThan(name.length / 2 + 1);
      expect(/^(.+?)\s+\1$/u.test(normalized), name).toBe(false);
    }
  });
});
