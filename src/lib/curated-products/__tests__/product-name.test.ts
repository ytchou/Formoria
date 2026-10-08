import { describe, expect, it } from "vitest";

import {
  isShopSkuToken,
  normalizeCuratedProductName,
  publicCuratedProductName,
  stripTrailingModelCode,
} from "../product-name";
import catalog from "./fixtures/catalog-names-2026-10-08.json";
import stagingCatalog from "./fixtures/staging-catalog-names-2026-10-08.json";

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

  it("strips an 8-digit shop SKU directly after CJK text (DEV-1989)", () => {
    expect(normalizeCuratedProductName("綁帶甜椒日・白菊姊姊 32141747")).toBe(
      "綁帶甜椒日・白菊姊姊",
    );
    expect(normalizeCuratedProductName("小花梅醬的花園・ピクニック 32150811")).toBe(
      "小花梅醬的花園・ピクニック",
    );
    expect(normalizeCuratedProductName("城市迷宮〈淺黃〉 32980605")).toBe("城市迷宮〈淺黃〉");
    expect(normalizeCuratedProductName("復刻章「數字」 41020001")).toBe("復刻章「數字」");
  });

  it("keeps 8 digits after Latin text, where they read as a model number", () => {
    expect(normalizeCuratedProductName("辦公椅 DKGP 10131234")).toBe("辦公椅 DKGP 10131234");
    expect(normalizeCuratedProductName("Model 32141747")).toBe("Model 32141747");
    expect(normalizeCuratedProductName("鋼筆 2024 32141747")).toBe("鋼筆 2024 32141747");
  });

  it("keeps digit tails that are not exactly 8 digits, or not space-separated", () => {
    expect(normalizeCuratedProductName("三重紗漂亮裙 003")).toBe("三重紗漂亮裙 003");
    expect(normalizeCuratedProductName("白菊姊姊 321417470")).toBe("白菊姊姊 321417470");
    expect(normalizeCuratedProductName("白菊姊姊32141747")).toBe("白菊姊姊32141747");
  });

  it("strips a shop token glued to a fullwidth closing bracket", () => {
    expect(normalizeCuratedProductName("石虎機能設計襪（女款）fv6wjmPG")).toBe("石虎機能設計襪（女款）");
    expect(normalizeCuratedProductName("書籤「鯨落」q2wz7ii6")).toBe("書籤「鯨落」");
    expect(normalizeCuratedProductName("書籤『鯨落』q2wz7ii6")).toBe("書籤『鯨落』");
    expect(normalizeCuratedProductName("書籤【鯨落】q2wz7ii6")).toBe("書籤【鯨落】");
    expect(normalizeCuratedProductName("書籤〔鯨落〕q2wz7ii6")).toBe("書籤〔鯨落〕");
  });

  it("keeps a glued token after any other character, or a name-shaped one", () => {
    expect(normalizeCuratedProductName("書籤〉q2wz7ii6")).toBe("書籤〉q2wz7ii6");
    expect(normalizeCuratedProductName("書籤)q2wz7ii6")).toBe("書籤)q2wz7ii6");
    expect(normalizeCuratedProductName("鯨落q2wz7ii6")).toBe("鯨落q2wz7ii6");
    expect(normalizeCuratedProductName("沙發（款）Chamonix")).toBe("沙發（款）Chamonix");
    expect(normalizeCuratedProductName("鋼筆（黑）DKGP1013")).toBe("鋼筆（黑）DKGP1013");
  });

  it("trims a separator left dangling by a stripped token", () => {
    expect(normalizeCuratedProductName("金屬雙用靜音桌鐘 Mesa - 1y9JSeGG")).toBe("金屬雙用靜音桌鐘 Mesa");
    expect(normalizeCuratedProductName("桌鐘 Mesa – 1y9JSeGG")).toBe("桌鐘 Mesa");
    expect(normalizeCuratedProductName("桌鐘 Mesa — 1y9JSeGG")).toBe("桌鐘 Mesa");
    expect(normalizeCuratedProductName("桌鐘 Mesa | 1y9JSeGG")).toBe("桌鐘 Mesa");
    expect(normalizeCuratedProductName("桌鐘 Mesa / 1y9JSeGG")).toBe("桌鐘 Mesa");
    expect(normalizeCuratedProductName("春聯｜馬上有錢｜ wzSu3eaa")).toBe("春聯｜馬上有錢");
    expect(normalizeCuratedProductName("春聯・ wzSu3eaa")).toBe("春聯");
    expect(normalizeCuratedProductName("春聯／ 32141747")).toBe("春聯");
  });

  it("trims no separator when no token was stripped", () => {
    expect(normalizeCuratedProductName("桌鐘 Mesa -")).toBe("桌鐘 Mesa -");
    expect(normalizeCuratedProductName("ocean /// 925純銀")).toBe("ocean /// 925純銀");
    expect(normalizeCuratedProductName("春聯｜")).toBe("春聯｜");
  });

  it("keeps a Latin letter l, which is not a separator", () => {
    expect(normalizeCuratedProductName("Celebrate慶祝花圈戒指 l 世界的微光 ndRssjP6")).toBe(
      "Celebrate慶祝花圈戒指 l 世界的微光",
    );
  });

  it("never empties a name that is only a token", () => {
    expect(normalizeCuratedProductName("7cFSL8yz")).toBe("7cFSL8yz");
  });

  it("is idempotent", () => {
    const once = normalizeCuratedProductName("Your Monkey 眼鏡架兼存錢筒 7cFSL8yz");
    expect(normalizeCuratedProductName(once)).toBe(once);
    const digits = normalizeCuratedProductName("綁帶甜椒日・白菊姊姊 32141747");
    expect(normalizeCuratedProductName(digits)).toBe(digits);
  });
});

describe("publicCuratedProductName", () => {
  it("returns the normalised name", () => {
    expect(publicCuratedProductName("米拉諾蕾絲緞帶德訓鞋 khNTqkeV")).toBe("米拉諾蕾絲緞帶德訓鞋");
  });

  it("falls back to the stored value when normalising would empty it", () => {
    expect(publicCuratedProductName("   ")).toBe("   ");
  });

  // Round-2 review: these three led the first home screen.
  it.each([
    ["6cm超穩跟繫帶高跟鞋 LA034-000-OBK", "6cm超穩跟繫帶高跟鞋"],
    ["冰淇淋球布偶 HFMIC26-0722", "冰淇淋球布偶"],
    ["精品無框磁吸廣告架 OKEMARU_31", "精品無框磁吸廣告架"],
  ])("hides the trailing model code in %s", (name, expected) => {
    expect(publicCuratedProductName(name)).toBe(expected);
  });

  it("hides a model code left once a shop token is stripped", () => {
    expect(publicCuratedProductName("日檜布墊餐椅 MO-JC20-1 aBcDeF12")).toBe("日檜布墊餐椅");
  });

  it("never changes the stored name the backfill writes", () => {
    expect(normalizeCuratedProductName("6cm超穩跟繫帶高跟鞋 LA034-000-OBK")).toBe(
      "6cm超穩跟繫帶高跟鞋 LA034-000-OBK",
    );
  });
});

describe("stripTrailingModelCode", () => {
  it.each([
    // Lowercase segments: a phrase, not a code.
    "三合一收納包 2-in-1",
    "原創經典室內拖鞋 YWC_core_001",
    // No capital: a year range or a plain number.
    "年曆 2025-26",
    "辦公椅腳輪 6004-23",
    // Fewer than two digits.
    "托特包 AB-CD-E1",
    // No separator: the documented ceiling.
    "防水機能薄襪 DKGP730",
    // Latin-only head: the code may be the name.
    "Dyson V15-X2",
    "Velcro PATCH",
    // A code with nothing in front of it.
    "LA034-000-OBK",
  ])("keeps %s", (name) => {
    expect(stripTrailingModelCode(name)).toBe(name);
  });

  it("is idempotent", () => {
    const once = stripTrailingModelCode("新馬可床架 MO-J11");
    expect(stripTrailingModelCode(once)).toBe(once);
  });
});

/**
 * Guard over the real catalog (DS-03): the 2026-10-08 scan counted 173 SKU
 * names and 5 doubled names. A change to the heuristic that drifts from that
 * count, or that leaves either pattern behind, fails here.
 */
describe("catalog guard (2026-10-08 scan)", () => {
  const trailingToken = /\s+[A-Za-z0-9]{8}$/;

  // 173 alphanumeric tokens, plus the 5 all-digit tails after CJK text that
  // DEV-1989 (DS2-01) added to the rule.
  it("strips exactly the 178 SKU-suffixed names the reviews counted", () => {
    const changed = catalog.trailingTokenNames.filter(
      (name) => normalizeCuratedProductName(name) !== name,
    );
    expect(changed).toHaveLength(178);
    expect(changed.filter((name) => /\s\d{8}$/.test(name))).toEqual([
      "多WAY皺皺掛繩 41020001",
      "綁帶甜椒日・白菊姊姊 32141747",
      "小花梅醬的花園・ピクニック 32150811",
      "紅色雨靴的日子 32980605",
      "樂芙日・黃花悠悠 32020832",
    ]);
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

/**
 * Real names from the 2026-10-08 staging review (DEV-1989, DS2-01): every
 * token shape the review quoted, the two doubled names, and clean names —
 * model codes, units, short numbers — that must render unchanged.
 */
describe("staging catalog fixture (2026-10-08 review)", () => {
  it.each(stagingCatalog.cases)("renders $name as $expected", ({ name, expected }) => {
    expect(publicCuratedProductName(name)).toBe(expected);
  });

  it("covers both token names and clean names", () => {
    const changed = stagingCatalog.cases.filter(({ name, expected }) => name !== expected);
    const clean = stagingCatalog.cases.filter(({ name, expected }) => name === expected);
    expect(changed.length).toBeGreaterThanOrEqual(15);
    expect(clean.length).toBeGreaterThanOrEqual(10);
  });
});
