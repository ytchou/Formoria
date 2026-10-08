import { describe, expect, it } from "vitest";

import { findCommerceTruthText } from "../commerce-text";

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
