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
    ["全館 85%", "%"],
    ["全館８５％", "％"],
    ["全館8折", "折"],
    ["現省一百", "省"],
    ["買一送一 加贈好禮", "贈"],
    ["限時優惠", "限時"],
  ])("flags %s as %s", (text, marker) => {
    expect(findCommerceTruthText(text)).toContain(marker);
  });

  it("reports each marker once however often it repeats", () => {
    expect(findCommerceTruthText("$1 $2 $3 省 省")).toEqual(["$", "省"]);
  });

  it.each([
    ["MINT 薄荷"],
    ["元素"],
    ["多元"],
    ["OR-21 鋼筆 710ml"],
    ["PRINT 2026"],
    [""],
  ])("passes clean text %j", (text) => {
    expect(findCommerceTruthText(text)).toEqual([]);
  });
});
