import { describe, expect, it } from "vitest";

import {
  createPublicNameResolver,
  hasIsbn10CheckDigit,
  isShopSkuToken,
  normalizeCuratedProductName,
  type PublicNameSibling,
} from "../product-name";
import catalog from "./fixtures/catalog-names-2026-10-08.json";
import stagingCatalog from "./fixtures/staging-catalog-names-2026-10-08.json";

describe("isShopSkuToken", () => {
  it.each([
    "7cFSL8yz",
    "zJJGtwgx",
    "QJVtWFVy",
    "q2wz7ii6",
    "AuCXmkNG",
    "998twnrh",
    "mvgmaaE5",
  ])("flags the random token %s", (token) => {
    expect(isShopSkuToken(token)).toBe(true);
  });

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
    expect(
      normalizeCuratedProductName("Your Monkey 眼鏡架兼存錢筒 7cFSL8yz"),
    ).toBe("Your Monkey 眼鏡架兼存錢筒");
    expect(
      normalizeCuratedProductName("Handscript 手稿藝術家系列鋼珠筆 zJJGtwgx"),
    ).toBe("Handscript 手稿藝術家系列鋼珠筆");
    expect(normalizeCuratedProductName("小直角書籤-鯨落 q2wz7ii6")).toBe(
      "小直角書籤-鯨落",
    );
  });

  it("collapses a name written twice", () => {
    expect(normalizeCuratedProductName("啵啵杯710ml 啵啵杯710ml")).toBe(
      "啵啵杯710ml",
    );
    expect(normalizeCuratedProductName("T Torch T Torch")).toBe("T Torch");
  });

  it("collapses a name written more than twice to one copy", () => {
    expect(normalizeCuratedProductName("T Torch T Torch T Torch")).toBe(
      "T Torch",
    );
    expect(
      normalizeCuratedProductName(
        "啵啵杯710ml 啵啵杯710ml 啵啵杯710ml 啵啵杯710ml",
      ),
    ).toBe("啵啵杯710ml");
  });

  it("keeps a single Latin word said twice, which is the name itself", () => {
    expect(normalizeCuratedProductName("Bloom Bloom")).toBe("Bloom Bloom");
    expect(normalizeCuratedProductName("Bloom Bloom 造型貼紙卷")).toBe(
      "Bloom Bloom 造型貼紙卷",
    );
  });

  it("handles both defects on one name", () => {
    expect(
      normalizeCuratedProductName("啵啵杯710ml 啵啵杯710ml 7cFSL8yz"),
    ).toBe("啵啵杯710ml");
  });

  it("keeps real model names and units", () => {
    expect(normalizeCuratedProductName("鋼筆 OR-21")).toBe("鋼筆 OR-21");
    expect(normalizeCuratedProductName("啵啵杯710ml")).toBe("啵啵杯710ml");
    expect(normalizeCuratedProductName("經典條紋美麗諾羊毛毯 CHECK350")).toBe(
      "經典條紋美麗諾羊毛毯 CHECK350",
    );
    expect(normalizeCuratedProductName("夏慕尼沙發 Chamonix")).toBe(
      "夏慕尼沙發 Chamonix",
    );
  });

  it("strips an 8-digit shop SKU directly after CJK text (DEV-1989)", () => {
    expect(normalizeCuratedProductName("綁帶甜椒日・白菊姊姊 32141747")).toBe(
      "綁帶甜椒日・白菊姊姊",
    );
    expect(
      normalizeCuratedProductName("小花梅醬的花園・ピクニック 32150811"),
    ).toBe("小花梅醬的花園・ピクニック");
    expect(normalizeCuratedProductName("城市迷宮〈淺黃〉 32980605")).toBe(
      "城市迷宮〈淺黃〉",
    );
    expect(normalizeCuratedProductName("復刻章「數字」 41020001")).toBe(
      "復刻章「數字」",
    );
  });

  it("keeps 8 digits after Latin text, where they read as a model number", () => {
    expect(normalizeCuratedProductName("辦公椅 DKGP 10131234")).toBe(
      "辦公椅 DKGP 10131234",
    );
    // A valid EAN-8 is a barcode, not a shop number (DEV-2046).
    expect(normalizeCuratedProductName("巧克力 47112346")).toBe(
      "巧克力 47112346",
    );
    expect(normalizeCuratedProductName("Model 32141747")).toBe(
      "Model 32141747",
    );
    expect(normalizeCuratedProductName("鋼筆 2024 32141747")).toBe(
      "鋼筆 2024 32141747",
    );
  });

  it("keeps digit tails that are not exactly 8 digits, or not space-separated", () => {
    expect(normalizeCuratedProductName("三重紗漂亮裙 003")).toBe(
      "三重紗漂亮裙 003",
    );
    expect(normalizeCuratedProductName("白菊姊姊 321417470")).toBe(
      "白菊姊姊 321417470",
    );
    expect(normalizeCuratedProductName("白菊姊姊32141747")).toBe(
      "白菊姊姊32141747",
    );
  });

  it("strips a shop token glued to a fullwidth closing bracket", () => {
    expect(normalizeCuratedProductName("石虎機能設計襪（女款）fv6wjmPG")).toBe(
      "石虎機能設計襪（女款）",
    );
    expect(normalizeCuratedProductName("書籤「鯨落」q2wz7ii6")).toBe(
      "書籤「鯨落」",
    );
    expect(normalizeCuratedProductName("書籤『鯨落』q2wz7ii6")).toBe(
      "書籤『鯨落』",
    );
    expect(normalizeCuratedProductName("書籤【鯨落】q2wz7ii6")).toBe(
      "書籤【鯨落】",
    );
    expect(normalizeCuratedProductName("書籤〔鯨落〕q2wz7ii6")).toBe(
      "書籤〔鯨落〕",
    );
  });

  it("keeps a glued token after any other character, or a name-shaped one", () => {
    expect(normalizeCuratedProductName("書籤〉q2wz7ii6")).toBe(
      "書籤〉q2wz7ii6",
    );
    expect(normalizeCuratedProductName("書籤)q2wz7ii6")).toBe("書籤)q2wz7ii6");
    expect(normalizeCuratedProductName("鯨落q2wz7ii6")).toBe("鯨落q2wz7ii6");
    expect(normalizeCuratedProductName("沙發（款）Chamonix")).toBe(
      "沙發（款）Chamonix",
    );
    expect(normalizeCuratedProductName("鋼筆（黑）DKGP1013")).toBe(
      "鋼筆（黑）DKGP1013",
    );
  });

  it("trims a separator left dangling by a stripped token", () => {
    expect(
      normalizeCuratedProductName("金屬雙用靜音桌鐘 Mesa - 1y9JSeGG"),
    ).toBe("金屬雙用靜音桌鐘 Mesa");
    expect(normalizeCuratedProductName("桌鐘 Mesa – 1y9JSeGG")).toBe(
      "桌鐘 Mesa",
    );
    expect(normalizeCuratedProductName("桌鐘 Mesa — 1y9JSeGG")).toBe(
      "桌鐘 Mesa",
    );
    expect(normalizeCuratedProductName("桌鐘 Mesa | 1y9JSeGG")).toBe(
      "桌鐘 Mesa",
    );
    expect(normalizeCuratedProductName("桌鐘 Mesa / 1y9JSeGG")).toBe(
      "桌鐘 Mesa",
    );
    expect(normalizeCuratedProductName("春聯｜馬上有錢｜ wzSu3eaa")).toBe(
      "春聯｜馬上有錢",
    );
    expect(normalizeCuratedProductName("春聯・ wzSu3eaa")).toBe("春聯");
    expect(normalizeCuratedProductName("春聯／ 32141747")).toBe("春聯");
  });

  it("trims no separator when no token was stripped", () => {
    expect(normalizeCuratedProductName("桌鐘 Mesa -")).toBe("桌鐘 Mesa -");
    expect(normalizeCuratedProductName("ocean /// 925純銀")).toBe(
      "ocean /// 925純銀",
    );
    expect(normalizeCuratedProductName("春聯｜")).toBe("春聯｜");
  });

  it("keeps a Latin letter l, which is not a separator", () => {
    expect(
      normalizeCuratedProductName(
        "Celebrate慶祝花圈戒指 l 世界的微光 ndRssjP6",
      ),
    ).toBe("Celebrate慶祝花圈戒指 l 世界的微光");
  });

  it("never empties a name that is only a token", () => {
    expect(normalizeCuratedProductName("7cFSL8yz")).toBe("7cFSL8yz");
  });

  it("is idempotent", () => {
    const once = normalizeCuratedProductName(
      "Your Monkey 眼鏡架兼存錢筒 7cFSL8yz",
    );
    expect(normalizeCuratedProductName(once)).toBe(once);
    const digits = normalizeCuratedProductName("綁帶甜椒日・白菊姊姊 32141747");
    expect(normalizeCuratedProductName(digits)).toBe(digits);
  });
});

/** The public name of a row alone in its brand: no sibling can collide. */
function soloPublicName(
  name: string,
  officialUrl: string | null = null,
): string {
  return createPublicNameResolver([])(
    { id: "solo", brandId: "brand-solo", officialUrl },
    "name_zh",
    name,
  );
}

describe("public name with no sibling", () => {
  it("returns the normalised name", () => {
    expect(soloPublicName("米拉諾蕾絲緞帶德訓鞋 khNTqkeV")).toBe(
      "米拉諾蕾絲緞帶德訓鞋",
    );
  });

  it("falls back to the stored value when normalising would empty it", () => {
    expect(soloPublicName("   ")).toBe("   ");
  });

  // Round-2 review: these three led the first home screen.
  it.each([
    ["6cm超穩跟繫帶高跟鞋 LA034-000-OBK", "6cm超穩跟繫帶高跟鞋"],
    ["冰淇淋球布偶 HFMIC26-0722", "冰淇淋球布偶"],
    ["精品無框磁吸廣告架 OKEMARU_31", "精品無框磁吸廣告架"],
  ])("hides the trailing model code in %s", (name, expected) => {
    expect(soloPublicName(name)).toBe(expected);
  });

  it("hides a model code left once a shop token is stripped", () => {
    expect(soloPublicName("日檜布墊餐椅 MO-JC20-1 aBcDeF12")).toBe(
      "日檜布墊餐椅",
    );
  });

  it("never changes the stored name the backfill writes", () => {
    expect(
      normalizeCuratedProductName("6cm超穩跟繫帶高跟鞋 LA034-000-OBK"),
    ).toBe("6cm超穩跟繫帶高跟鞋 LA034-000-OBK");
  });
});

const ZOODI_KIT =
  "https://zoodi.com.tw/shop/products/item/3040094558316/zoodi%20%E8%82%8C%E8%86%9A%E6%80%A5%E6%95%91%E7%AE%B1";

function sibling(
  id: string,
  nameZh: string,
  overrides: Partial<PublicNameSibling> = {},
): PublicNameSibling {
  return {
    id,
    brandId: "brand-a",
    nameZh,
    nameEn: null,
    officialUrl: null,
    ...overrides,
  };
}

/** Resolves `siblings[index]`'s Chinese name against the whole set. */
function resolveAt(siblings: PublicNameSibling[], index: number): string {
  const row = siblings[index]!;
  return createPublicNameResolver(siblings)(
    { id: row.id, brandId: row.brandId, officialUrl: row.officialUrl },
    "name_zh",
    row.nameZh!,
  );
}

/**
 * DEV-2046: a display-only token is hidden only when no other row of the same
 * brand would then read the same. Names from the 2026-10-18 production census.
 */
describe("createPublicNameResolver", () => {
  it("keeps both boingboing codes when hiding them would merge the pair", () => {
    const siblings = [
      sibling("b", "小紅帽與大野狼厚底休閒鞋 BO-1907B"),
      sibling("c", "小紅帽與大野狼厚底休閒鞋 BO-1907C"),
    ];
    expect(resolveAt(siblings, 0)).toBe("小紅帽與大野狼厚底休閒鞋 BO-1907B");
    expect(resolveAt(siblings, 1)).toBe("小紅帽與大野狼厚底休閒鞋 BO-1907C");
  });

  it("keeps umu's code when a sibling's bare name equals the hidden one", () => {
    // The sibling's code has no separator, so it renders — a display-equality
    // check would miss this; the bare-name comparison catches it.
    const siblings = [
      sibling("t", "非洲柚木一枚板 T0417505A14VB-1"),
      sibling("p", "非洲柚木一枚板 P0208302A18VB"),
    ];
    expect(resolveAt(siblings, 0)).toBe("非洲柚木一枚板 T0417505A14VB-1");
    expect(resolveAt(siblings, 1)).toBe("非洲柚木一枚板 P0208302A18VB");
  });

  it("still hides a code alone in its brand (DEV-1989)", () => {
    const siblings = [
      sibling("b", "小紅帽與大野狼厚底休閒鞋 BO-1907B"),
      sibling("x", "雨天帆布托特包"),
    ];
    expect(resolveAt(siblings, 0)).toBe("小紅帽與大野狼厚底休閒鞋");
  });

  it("hides a Zoodi listing number its official URL repeats", () => {
    const siblings = [
      sibling("k", "肌膚急救箱 3040094558316", { officialUrl: ZOODI_KIT }),
    ];
    expect(resolveAt(siblings, 0)).toBe("肌膚急救箱");
  });

  it("keeps the listing number when a sibling already has the bare name", () => {
    const siblings = [
      sibling("k", "肌膚急救箱 3040094558316", { officialUrl: ZOODI_KIT }),
      sibling("plain", "肌膚急救箱"),
    ];
    expect(resolveAt(siblings, 0)).toBe("肌膚急救箱 3040094558316");
  });

  it("never treats the same name in another brand as a collision", () => {
    const siblings = [
      sibling("b", "小紅帽與大野狼厚底休閒鞋 BO-1907B"),
      sibling("c", "小紅帽與大野狼厚底休閒鞋 BO-1907C", {
        brandId: "brand-b",
      }),
    ];
    expect(resolveAt(siblings, 0)).toBe("小紅帽與大野狼厚底休閒鞋");
    expect(resolveAt(siblings, 1)).toBe("小紅帽與大野狼厚底休閒鞋");
  });

  it("fails safe on a failed sibling read: stored names, nothing hidden", () => {
    const resolve = createPublicNameResolver(null);
    const row = { id: "k", brandId: "brand-a", officialUrl: ZOODI_KIT };
    expect(resolve(row, "name_zh", "肌膚急救箱 3040094558316")).toBe(
      "肌膚急救箱 3040094558316",
    );
    expect(resolve(row, "name_zh", "6cm超穩跟繫帶高跟鞋 LA034-000-OBK")).toBe(
      "6cm超穩跟繫帶高跟鞋 LA034-000-OBK",
    );
    // DEV-2046 C4: a shop token is a hidden token too, so it stays.
    expect(resolve(row, "name_zh", " 米拉諾蕾絲緞帶德訓鞋 khNTqkeV ")).toBe(
      "米拉諾蕾絲緞帶德訓鞋 khNTqkeV",
    );
  });

  it("falls back one level at a time: the normalised name keeps its code", () => {
    const siblings = [
      sibling("a", "日檜布墊餐椅 MO-JC20-1 aBcDeF12"),
      sibling("b", "日檜布墊餐椅"),
    ];
    expect(resolveAt(siblings, 0)).toBe("日檜布墊餐椅 MO-JC20-1");
  });

  it("guards both name columns as one namespace (C3)", () => {
    // English surfaces fall back to `name_zh`, so `a`'s Chinese name would
    // read `Mesa` beside `b`'s English `Mesa`.
    const siblings = [
      sibling("a", "Mesa 30400945581", {
        officialUrl: "https://shop.example/item/30400945581",
      }),
      sibling("b", "桌鐘", { nameEn: "Mesa" }),
    ];
    expect(resolveAt(siblings, 0)).toBe("Mesa 30400945581");
    const hidesAlone = [siblings[0]!];
    expect(resolveAt(hidesAlone, 0)).toBe("Mesa");
  });

  it.each([
    [
      "listing number",
      "杯 12345 LA034-000-OBK",
      "杯 12345",
      "杯",
      { officialUrl: "https://shop.example/item/12345" },
      "杯 12345",
    ],
    [
      "model code",
      "鞋 AB12-CD3 LA034-000-OBK",
      "鞋 AB12-CD3",
      "鞋",
      {},
      "鞋 AB12-CD3",
    ],
  ])(
    "never cascades a hidden %s onto a guarded sibling's name (C1)",
    (_label, x, y, z, yOverrides, yRendered) => {
      // `y` is guarded by `z` and keeps its suffix; `x` hiding its code would
      // then read exactly as `y`, so `x` keeps its code too.
      const siblings = [
        sibling("x", x),
        sibling("y", y, yOverrides),
        sibling("z", z),
      ];
      expect(resolveAt(siblings, 2)).toBe(z);
      expect(resolveAt(siblings, 1)).toBe(yRendered);
      expect(resolveAt(siblings, 0)).toBe(x);
    },
  );

  it("trims the separator a hidden token leaves dangling (C2)", () => {
    expect(
      soloPublicName(
        "桌鐘 Mesa - 3040094558317",
        "https://shop.example/item/3040094558317",
      ),
    ).toBe("桌鐘 Mesa");
    expect(soloPublicName("鞋 ｜ LA034-000-OBK")).toBe("鞋");
  });

  it("keeps the shop tokens of twins the token alone tells apart (C4)", () => {
    const siblings = [
      sibling("one", "多WAY皺皺掛繩 41020001"),
      sibling("two", "多WAY皺皺掛繩 41020002"),
    ];
    expect(resolveAt(siblings, 0)).toBe("多WAY皺皺掛繩 41020001");
    expect(resolveAt(siblings, 1)).toBe("多WAY皺皺掛繩 41020002");
    const tokens = [
      sibling("m", "米拉諾蕾絲緞帶德訓鞋 khNTqkeV"),
      sibling("n", "米拉諾蕾絲緞帶德訓鞋"),
    ];
    expect(resolveAt(tokens, 0)).toBe("米拉諾蕾絲緞帶德訓鞋 khNTqkeV");
  });

  it("still strips a shop token alone in its brand, and keeps a valid EAN-8 (C4)", () => {
    expect(soloPublicName("多WAY皺皺掛繩 41020001")).toBe("多WAY皺皺掛繩");
    expect(soloPublicName("巧克力 47112346")).toBe("巧克力 47112346");
  });
});

describe("URL listing number on a public name", () => {
  it("hides the listing number the official URL carries", () => {
    expect(soloPublicName("肌膚急救箱 3040094558316", ZOODI_KIT)).toBe(
      "肌膚急救箱",
    );
  });

  it.each([
    // A GTIN, even when the URL repeats it.
    [
      "tobe-craft",
      "繪本 9784529072915",
      "https://tobecraft.com/products/9784529072915",
    ],
    // `bgm72015` is one segment, not `72015`.
    ["2bm", "黑膠唱盤 BGM 72015", "https://2bm.example/products/bgm72015"],
    // Not in the URL at all.
    ["sobdeall", "棉麻上衣 20101000102", "https://sobdeall.example/item/77"],
    // Four digits: a short number, never a listing id.
    ["four digits", "陶杯 2024", "https://shop.example/item/2024"],
    // A quantity.
    ["quantity", "頭皮淨化液 260mL", "https://shop.example/item/260ml"],
    // Six digits inside a longer segment.
    ["substring", "餐盤 123456", "https://shop.example/p123456789"],
    // A valid ISBN-10 in the URL.
    ["ISBN-10", "圖鑑 4834000826", "https://shop.example/book/4834000826"],
  ])("keeps the %s suffix", (_label, name, url) => {
    expect(soloPublicName(name, url)).toBe(name);
  });
});

describe("hasIsbn10CheckDigit", () => {
  it("accepts a valid ISBN-10 and rejects a near miss", () => {
    expect(hasIsbn10CheckDigit("4834000826")).toBe(true);
    expect(hasIsbn10CheckDigit("4834000827")).toBe(false);
    expect(hasIsbn10CheckDigit("483400082")).toBe(false);
  });
});

describe("trailing model code on a public name", () => {
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
    expect(soloPublicName(name)).toBe(name);
  });

  it("is idempotent", () => {
    const once = soloPublicName("新馬可床架 MO-J11");
    expect(once).toBe("新馬可床架");
    expect(soloPublicName(once)).toBe(once);
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
  it.each(stagingCatalog.cases)(
    "renders $name as $expected",
    ({ name, expected }) => {
      expect(soloPublicName(name)).toBe(expected);
    },
  );

  it("covers both token names and clean names", () => {
    const changed = stagingCatalog.cases.filter(
      ({ name, expected }) => name !== expected,
    );
    const clean = stagingCatalog.cases.filter(
      ({ name, expected }) => name === expected,
    );
    expect(changed.length).toBeGreaterThanOrEqual(15);
    expect(clean.length).toBeGreaterThanOrEqual(10);
  });
});
