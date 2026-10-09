import { describe, expect, it } from "vitest";

import {
  findAdCreativeSignals,
  findCommerceTruthText,
  findImageRejectionReasons,
  type ImageTextSignals,
} from "../commerce-text";

/**
 * The commerce-truth marker scan (DEV-1962). Formoria never stores price,
 * discount, or promotion; these markers are how text read off an image, or
 * carried on a product, is recognised as one of those.
 */
describe("findCommerceTruthText", () => {
  it("flags every marker on the LAB52 homepage wall image", () => {
    const text = ["9月淨齒節 滿額最高再省$220", "贈", "$589", "原價$676"].join(
      "\n",
    );

    expect(findCommerceTruthText(text)).toEqual(["$", "省", "贈"]);
  });

  it.each([
    ["＄599", "＄"],
    ["NT$599", "NT"],
    ["NTD 599", "NT"],
    ["NT 599", "NT"],
    ["nt599", "NT"],
    ["599元", "元"],
    ["５９９ 元", "元"],
    ["全館 20% OFF", "%"],
    ["最高省３０％", "%"],
    ["折扣 15%", "%"],
    ["全館8折", "折"],
    ["週年慶 7.9 折", "折"],
    ["結帳打折", "折"],
    ["現省一百", "省"],
    ["再省 NT$100", "省"],
    ["買一送一 加贈好禮", "贈"],
    ["限時優惠", "限時"],
  ])("flags %s as %s", (text, marker) => {
    expect(findCommerceTruthText(text)).toContain(marker);
  });

  it("reports each marker once however often it repeats", () => {
    expect(findCommerceTruthText("$1 $2 $3 省5 省6")).toEqual(["$", "省"]);
  });

  it.each([
    ["MINT 薄荷"],
    ["元素"],
    ["多元"],
    ["OR-21 鋼筆 710ml"],
    ["PRINT 2026"],
    // Product facts the literal rule flagged on staging (2026-10-08).
    ["22%維生素C高效美白精華"],
    ["日本原裝85%高Omega-3魚油"],
    ["UPF50+ 99%抗UV"],
    ["100% 純棉"],
    ["折疊室內拖鞋"],
    ["3折傘 輕量"],
    ["省力設計 省電模式"],
    ["Official site"],
    [""],
  ])("passes clean text %j", (text) => {
    expect(findCommerceTruthText(text)).toEqual([]);
  });
});

/**
 * Advertising creatives (DEV-1989). The staging review found three that the
 * commerce markers let through: a spokesperson ad for a face mask, a mug with
 * 「客製圖案 一件可印」 laid over it, and a tile carrying a banner.
 */
const ENDORSEMENT_AD: ImageTextSignals = {
  text: "超導晶凍面膜 Plus\n品牌代言人\n水潤透亮 一敷見效",
  textCoverage: 0.12,
  endorsementPerson: true,
};
const CUSTOM_PRINT_OVERLAY: ImageTextSignals = {
  text: "客製圖案 一件可印\n蓋賀杯",
  textCoverage: 0.1,
  endorsementPerson: false,
};
const BANNER_TILE: ImageTextSignals = {
  text: "可收納吸管的雙層吸管杯",
  textCoverage: 0.22,
  endorsementPerson: false,
};

function clean(text: string, textCoverage = 0.05): ImageTextSignals {
  return { text, textCoverage, endorsementPerson: false };
}

describe("findAdCreativeSignals", () => {
  it("flags the spokesperson face-mask ad", () => {
    expect(findAdCreativeSignals(ENDORSEMENT_AD)).toEqual([
      "endorsement",
      "代言",
    ]);
  });

  // The 2026-10-09 staging run: a person fired on 233 of 1,337 images (216
  // with no other signal), nearly all ordinary on-model photos (swimsuits, a worn backpack).
  it("passes an on-model photo with no campaign copy", () => {
    expect(
      findAdCreativeSignals({ text: "", textCoverage: 0, endorsementPerson: true }),
    ).toEqual([]);
    expect(
      findAdCreativeSignals({
        text: "SNOWFLAKE DENIM",
        textCoverage: 0.04,
        endorsementPerson: true,
      }),
    ).toEqual([]);
  });

  it("counts the person when the frame also carries commerce copy", () => {
    expect(
      findAdCreativeSignals({
        text: "限時優惠 再省$220",
        textCoverage: 0.08,
        endorsementPerson: true,
      }),
    ).toEqual(["endorsement"]);
  });

  it("flags the 一件可印 custom-print overlay", () => {
    expect(findAdCreativeSignals(CUSTOM_PRINT_OVERLAY)).toEqual([
      "一件可印",
      "客製",
    ]);
  });

  it("flags the banner tile by its text coverage alone", () => {
    expect(findAdCreativeSignals(BANNER_TILE)).toEqual(["text-coverage"]);
  });

  it("treats coverage at exactly the threshold as clean", () => {
    expect(findAdCreativeSignals(clean("", 0.15))).toEqual([]);
  });

  it.each([
    ["1件可印", "一件可印"],
    ["一件就可印", "一件可印"],
    ["客製化禮物", "客製"],
    ["可客製姓名", "客製"],
    ["提供客製服務", "客製"],
    ["明星代言", "代言"],
    ["代言人推薦", "代言"],
    ["真心推薦", "推薦"],
    ["營養師強力推薦", "推薦"],
    ["本月推薦款", "推薦"],
  ])("flags ad copy %s as %s", (text, reason) => {
    expect(findAdCreativeSignals(clean(text))).toContain(reason);
  });

  it.each([
    ["22%維生素C高效美白精華"],
    ["100% 純棉"],
    ["3折傘 輕量"],
    ["MIT 台灣製造"],
    ["推薦用法：早晚各一次"],
    ["客製"],
    ["印花馬克杯 350ml"],
    [""],
  ])("passes clean text %j", (text) => {
    expect(findAdCreativeSignals(clean(text))).toEqual([]);
  });
});

describe("findImageRejectionReasons", () => {
  it.each([
    ["the endorsement ad", ENDORSEMENT_AD],
    ["the custom-print overlay", CUSTOM_PRINT_OVERLAY],
    ["the banner tile", BANNER_TILE],
  ])("rejects %s as an ad creative", (_label, signals) => {
    const reasons = findImageRejectionReasons(signals);
    expect(reasons.commerce).toEqual([]);
    expect(reasons.adCreative.length).toBeGreaterThan(0);
  });

  it("keeps the commerce markers separate from the ad-creative reasons", () => {
    expect(
      findImageRejectionReasons({
        text: "限時 8折 真心推薦",
        textCoverage: 0.3,
        endorsementPerson: false,
      }),
    ).toEqual({
      commerce: ["折", "限時"],
      adCreative: ["text-coverage", "推薦"],
    });
  });

  it.each([
    ["22%維生素C"],
    ["100% 純棉"],
    ["3折傘"],
    ["MIT 台灣製造"],
    // A product-only shot whose words are printed on the packaging.
    ["OR-21 鋼筆 710ml\n台灣製造"],
  ])("passes the clean product photo %j", (text) => {
    expect(findImageRejectionReasons(clean(text))).toEqual({
      commerce: [],
      adCreative: [],
    });
  });
});
