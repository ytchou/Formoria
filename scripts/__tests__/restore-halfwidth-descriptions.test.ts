import { describe, expect, it } from "vitest";

import {
  findPositionalNumerals,
  restoreHalfWidth,
} from "../restore-halfwidth-descriptions";

describe("restoreHalfWidth", () => {
  // Rows are the corrupted forms observed in production descriptions (DEV-1954).
  it.each([
    ["a full-width model number with Chinese digits", "吸塵器ＭＤ－八六〇Ｓ重量輕", "吸塵器MD-860S重量輕"],
    ["a half-width model number with Chinese digits", "吸塵器MD-八六〇S重量輕", "吸塵器MD-860S重量輕"],
    ["a full-width 3D", "配置三Ｄ立體揹帶", "配置3D立體揹帶"],
    ["a half-width 3D", "配置三D立體揹帶", "配置3D立體揹帶"],
    ["a 3C token", "三Ｃ配件收納", "3C配件收納"],
    ["a four-digit year", "創立於二〇一二年", "創立於2012年"],
    ["full-width certification names", "ＯＥＫＯ－ＴＥＸ與ＢＳＣＩ認證", "OEKO-TEX與BSCI認證"],
    ["a positional karat before a full-width K", "黃銅與十八Ｋ金", "黃銅與18K金"],
    ["a positional karat before a half-width K", "十四K包金線材", "14K包金線材"],
    ["a model number with a positional numeral", "ＣＮＳ一四七七四檢驗", "CNS14774檢驗"],
    ["a Chinese decimal", "重零點九八公斤", "重0.98公斤"],
  ])("repairs %s", (_label, source, expected) => {
    expect(restoreHalfWidth(source)).toBe(expected);
  });

  it.each([
    ["a positional numeral", "約七百五十公克"],
    ["a numeral inside Chinese prose", "第三代手工皮件，一次購足"],
    ["a single numeral right after a brand name", "inBlooom一直使用天然材質"],
    ["a numeral run not followed by 年", "二〇一二"],
    ["a CJK hyphen between Han characters", "台灣－製造"],
  ])("leaves %s unchanged", (_label, source) => {
    expect(restoreHalfWidth(source)).toBe(source);
  });
});

describe("findPositionalNumerals", () => {
  it("lists positional numerals for human review", () => {
    expect(findPositionalNumerals("約七百五十公克，容量三十毫升")).toEqual([
      "七百五十",
      "三十",
    ]);
  });

  it("returns nothing for digit-wise text", () => {
    expect(findPositionalNumerals("MD-860S，2012年")).toEqual([]);
  });
});
