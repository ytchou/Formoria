import { describe, expect, it } from "vitest";

import {
  censusNameSuffixes,
  classifyNameSuffix,
  hasGs1CheckDigit,
  summarizeCensus,
  type CensusRow,
} from "../census-name-suffixes";

/**
 * The DEV-2017 suffix census. Pure functions only: the read itself is a paged
 * select, and `scripts/check-test-boundaries.mjs` forbids mocking Supabase.
 * Fixtures are the shapes the 2026-10-15 staging census actually found.
 */

const ZOODI_KIT =
  "https://zoodi.com.tw/shop/products/item/3040094558316/zoodi%20%E8%82%8C%E8%86%9A%E6%80%A5%E6%95%91%E7%AE%B1";
const ZOODI_BALM =
  "https://zoodi.com.tw/shop/products/item/3040094558217/all-in-one-hydration-balm";

describe("hasGs1CheckDigit", () => {
  it("accepts a valid EAN-13 and ISBN-13", () => {
    expect(hasGs1CheckDigit("4006381333931")).toBe(true);
    expect(hasGs1CheckDigit("9784529072441")).toBe(true);
  });

  it("rejects the Zoodi listing numbers, which only look like barcodes", () => {
    expect(hasGs1CheckDigit("3040094558316")).toBe(false);
    expect(hasGs1CheckDigit("3040094558217")).toBe(false);
  });

  it("rejects lengths GS1 does not use", () => {
    expect(hasGs1CheckDigit("1234567")).toBe(false);
    expect(hasGs1CheckDigit("20101000102")).toBe(false);
  });
});

describe("classifyNameSuffix", () => {
  it("reads both ticket examples as the shop's listing number from the URL", () => {
    expect(classifyNameSuffix("肌膚急救箱 3040094558316", ZOODI_KIT)).toEqual({
      kind: "url_listing_id",
      token: "3040094558316",
      head: "肌膚急救箱",
      inUrl: true,
    });
    expect(
      classifyNameSuffix("全效保濕膏 3040094558217", ZOODI_BALM)?.kind,
    ).toBe("url_listing_id");
  });

  it("does not call a number a listing ID when the URL lacks it", () => {
    expect(
      classifyNameSuffix(
        "全效保濕膏 3040094558217",
        "https://zoodi.com.tw/shop",
      )?.kind,
    ).toBe("long_number");
  });

  it("matches a URL segment only whole, never as a substring", () => {
    expect(
      classifyNameSuffix(
        "自動折疊傘 6008001",
        "https://shop.buwudesign.com/products/6008",
      )?.kind,
    ).toBe("long_number");
  });

  it("keeps a valid barcode or ISBN as gtin even when the URL repeats it", () => {
    expect(
      classifyNameSuffix(
        "動物玩偶鉤針編織書 9784529072441",
        "https://tobecraft.com/products/9784529072441",
      ),
    ).toMatchObject({ kind: "gtin", inUrl: true });
  });

  it("classifies letters plus digits as a model code and notes a URL handle", () => {
    expect(
      classifyNameSuffix(
        "非洲柚木一枚板 T0814602A24VB",
        "https://www.umu.com.tw/products/pericopsis-elata-dining-table-working-table-wood-desk-t0814602a24vb",
      ),
    ).toMatchObject({ kind: "model_code", inUrl: true });
    expect(
      classifyNameSuffix("6cm超穩跟繫帶高跟鞋 LA034-000-OBK", null),
    ).toMatchObject({ kind: "model_code", inUrl: false });
  });

  it("reads units and packs as quantities", () => {
    expect(classifyNameSuffix("捷利爾頭皮淨化液 820mL", null)?.kind).toBe(
      "quantity",
    );
    expect(classifyNameSuffix("Sanitary Pads 8-Pack", null)?.kind).toBe(
      "quantity",
    );
  });

  it("reads 1–4 digits as a short number", () => {
    expect(classifyNameSuffix("人魚雙肩帶比基尼 013", null)?.kind).toBe(
      "short_number",
    );
  });

  it("finds 5+ digits glued to CJK text", () => {
    expect(
      classifyNameSuffix("肌膚急救箱3040094558316", ZOODI_KIT),
    ).toMatchObject({ kind: "url_listing_id", head: "肌膚急救箱" });
  });

  it("returns null for a name that ends in a word, even one the URL slug repeats", () => {
    expect(
      classifyNameSuffix(
        "Emily Leather Shoes Cream",
        "https://www.sanlyjoy.shop/products/emily-leather-shoes-cream",
      ),
    ).toBeNull();
    expect(classifyNameSuffix("陶土餐盤", null)).toBeNull();
    expect(classifyNameSuffix("3040094558316", ZOODI_KIT)).toBeNull();
  });
});

function row(overrides: Partial<CensusRow>): CensusRow {
  return {
    id: "a",
    brand_id: "brand-a",
    name_zh: "陶土餐盤",
    name_en: null,
    official_url: null,
    visible: true,
    brands: { slug: "island-studio" },
    ...overrides,
  };
}

describe("censusNameSuffixes", () => {
  it("flags a suffix that is the only thing telling two products apart", () => {
    const classified = censusNameSuffixes([
      row({ id: "a", name_zh: "非洲柚木一枚板 T0814601A24VB" }),
      row({ id: "b", name_zh: "非洲柚木一枚板 T0814602A24VB" }),
      row({ id: "c", brand_id: "brand-b", name_zh: "非洲柚木一枚板 T1" }),
    ]);
    expect(classified.map((item) => [item.id, item.collides])).toEqual([
      ["a", true],
      ["b", true],
      ["c", false],
    ]);
  });

  it("reports whether the public read already hides the suffix", () => {
    const [hidden, shown] = censusNameSuffixes([
      row({ id: "a", name_zh: "6cm超穩跟繫帶高跟鞋 LA034-000-OBK" }),
      row({
        id: "b",
        name_zh: "肌膚急救箱 3040094558316",
        official_url: ZOODI_KIT,
      }),
    ]);
    expect(hidden?.hiddenToday).toBe(true);
    expect(shown?.hiddenToday).toBe(false);
  });

  it("classifies the English column separately", () => {
    const classified = censusNameSuffixes([
      row({
        name_zh: "彈力氣墊拖鞋",
        name_en: "Elastic Air-Cushion Slides BCU5840",
      }),
    ]);
    expect(classified.map((item) => item.column)).toEqual(["name_en"]);
  });
});

describe("summarizeCensus", () => {
  it("counts names per kind, visible rows and collisions", () => {
    const rows = [
      row({
        id: "a",
        name_zh: "肌膚急救箱 3040094558316",
        official_url: ZOODI_KIT,
      }),
      row({
        id: "b",
        name_zh: "陶土餐盤",
        name_en: "Clay Plate 2",
        visible: false,
      }),
    ];
    const summary = summarizeCensus(rows, censusNameSuffixes(rows));
    expect(summary).toMatchObject({ rows: 2, names: 3, withSuffix: 2 });
    expect(summary.byKind.url_listing_id).toEqual({
      total: 1,
      visible: 1,
      hiddenToday: 0,
      collides: 0,
    });
    expect(summary.byKind.short_number.visible).toBe(0);
  });
});
