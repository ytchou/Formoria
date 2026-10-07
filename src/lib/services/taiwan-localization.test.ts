import { describe, expect, it } from "vitest";
import {
  foldFullWidthAlphanumerics,
  localizeToTW,
  stripAiToolArtifacts,
} from "./taiwan-localization";

const FORMATTING_LABEL = /^(markdown|emoji|punctuation):/u;

describe("localizeToTW — no vocabulary substitution", () => {
  // Vocabulary substitution was removed: 支語 is a review concern, not a
  // find-and-replace one, and rewriting a brand's own words was the bug. Each
  // row is a term the old table would have rewritten.
  // Labelled rows, not bare inputs: the empty-string case rendered a blank
  // subject in the reporter and could not be targeted with `-t`.
  it.each([
    ["an approval verb", "審核通過"],
    ["a made-in-Taiwan phrase", "支持台灣製造"],
    ["a floor-lamp noun", "落地燈"],
    ["a process noun", "程序"],
    ["a click verb", "點擊"],
    ["a video noun", "視頻"],
    ["a quality noun", "質量"],
    ["an information noun", "信息"],
    ["a user noun", "用戶"],
    ["a full sentence", "台灣品牌以品質著稱"],
    ["an empty string", ""],
  ])("leaves %s unchanged, with no substitution recorded", (_label, source) => {
    const r = localizeToTW(source);
    expect(r.text).toBe(source);
    expect(r.substitutions).toEqual([]);
  });

  it("substitutions no longer contain vocabulary labels", () => {
    const r = localizeToTW(
      "## 支持台灣製造🎉\n- 這個**落地燈**的質量很高,審核通過.",
    );
    expect(r.substitutions.length).toBeGreaterThan(0);
    for (const label of r.substitutions) {
      expect(label).toMatch(FORMATTING_LABEL);
    }
    expect(r.text).toContain("支持台灣製造");
    expect(r.text).toContain("落地燈");
    expect(r.text).toContain("審核通過");
  });

  it("preserves brand name when passed via options", () => {
    const r = localizeToTW("信息設計坊提供優質信息服務", {
      brandName: "信息設計坊",
    });
    expect(r.text).toBe("信息設計坊提供優質信息服務");
    expect(r.text).not.toContain("TW_PROTECTED");
  });

  it("preserves a brand name inside protected quotes without leaving placeholders", () => {
    const r = localizeToTW("品牌「信息設計坊」提供信息服務", {
      brandName: "信息設計坊",
    });
    expect(r.text).toBe("品牌「信息設計坊」提供信息服務");
    expect(r.text).not.toContain("TW_PROTECTED");
  });

  it("preserves text inside「」quotes", () => {
    const r = localizeToTW("他說「這個視頻質量不錯」但我覺得信息不足");
    expect(r.text).toBe("他說「這個視頻質量不錯」但我覺得信息不足");
  });

  it("preserves URLs unchanged", () => {
    const r = localizeToTW("詳見 https://example.com/视频信息 的說明");
    expect(r.text).toContain("https://example.com/视频信息");
  });
});

describe("localizeToTW — punctuation", () => {
  it.each([
    ["half-width , : ; ! between CJK", "品牌,設計:好;用!", "品牌，設計：好；用！"],
    ["an ellipsis", "品牌創立於2015年...至今已十年", "品牌創立於2015年⋯⋯至今已十年"],
    ["a sentence-final period", "這是台灣品牌.", "這是台灣品牌。"],
    ["parentheses", "台灣(品牌)設計", "台灣（品牌）設計"],
    ["a question mark", "這是台灣品牌?", "這是台灣品牌？"],
  ])("normalizes %s", (_label, source, expected) => {
    const r = localizeToTW(source);
    expect(r.text).toBe(expected);
    expect(r.substitutions).toContain("punctuation:normalized");
  });

  // The rule is positional, not global: half-width punctuation in an English
  // run is correct as typed.
  it("preserves half-width punctuation in English context", () => {
    const r = localizeToTW("Hello, world! 你好");
    expect(r.text).toContain("Hello, world!");
  });
});

// DEV-1954: the language-purity gate counted full-width letters as CJK, so the
// model "Chinese-ified" model numbers (MD-860S -> ＭＤ－８６０Ｓ) to pass it.
// Latin letters, digits and model numbers stay half-width in either language.
describe("localizeToTW — half-width alphanumerics", () => {
  it.each([
    ["a model number", "吸塵器 MD-860S 重量輕"],
    ["a certification name", "通過 OEKO-TEX 認證"],
    ["a digit-letter token", "配置 3D 立體揹帶"],
  ])("leaves a half-width %s untouched", (_label, source) => {
    const r = localizeToTW(source);
    expect(r.text).toBe(source);
    expect(r.substitutions).toEqual([]);
  });

  it.each([
    ["a model number", "吸塵器ＭＤ－８６０Ｓ重量輕", "吸塵器MD-860S重量輕"],
    ["a certification name", "通過ＯＥＫＯ－ＴＥＸ認證", "通過OEKO-TEX認證"],
    ["a digit-letter token", "配置３Ｄ立體揹帶", "配置3D立體揹帶"],
  ])("folds a full-width %s to half-width", (_label, source, expected) => {
    const r = localizeToTW(source);
    expect(r.text).toBe(expected);
    expect(r.substitutions).toContain("alphanumeric:half-width");
  });

  it("keeps CJK punctuation full-width while folding the model number", () => {
    const r = localizeToTW("吸塵器ＭＤ－８６０Ｓ重量輕，收納方便。");
    expect(r.text).toBe("吸塵器MD-860S重量輕，收納方便。");
  });

  it("leaves a full-width joiner between Han characters alone", () => {
    const r = localizeToTW("台灣－製造／設計");
    expect(r.text).toBe("台灣－製造／設計");
    expect(r.substitutions).toEqual([]);
  });

  it("folds English prose too", () => {
    const r = localizeToTW("The ＭＤ－８６０Ｓ vacuum", { language: "en" });
    expect(r.text).toBe("The MD-860S vacuum");
    expect(r.substitutions).toContain("alphanumeric:half-width");
  });

  it("leaves the protected brand name span untouched", () => {
    const r = localizeToTW("ＡＢＣ工作室推出ＭＤ－１型", {
      brandName: "ＡＢＣ工作室",
    });
    expect(r.text).toBe("ＡＢＣ工作室推出MD-1型");
  });
});

describe("foldFullWidthAlphanumerics", () => {
  it.each([
    ["letters, digits and a hyphen", "ＭＤ－８６０Ｓ", "MD-860S"],
    ["lowercase letters", "ｉｎＢｌｏｏｏｍ", "inBlooom"],
    ["a decimal point", "３．５公分", "3.5公分"],
    ["a slash and a plus", "Ａ／Ｂ與Ｃ＋＋", "A/B與C＋＋"],
  ])("folds %s", (_label, source, expected) => {
    expect(foldFullWidthAlphanumerics(source)).toBe(expected);
  });

  it("keeps CJK punctuation full-width", () => {
    expect(foldFullWidthAlphanumerics("品牌（台北）：好，讚。")).toBe(
      "品牌（台北）：好，讚。",
    );
  });
});

describe("localizeToTW — markdown stripping", () => {
  it("strips bold markers", () => {
    const r = localizeToTW("這是**品牌特色**的介紹");
    expect(r.text).toBe("這是品牌特色的介紹");
    expect(r.substitutions).toContain("markdown:bold");
  });

  it("strips underscore bold markers", () => {
    const r = localizeToTW("這是__品牌__的故事");
    expect(r.text).toBe("這是品牌的故事");
  });

  it("strips heading prefixes", () => {
    const r = localizeToTW("## 品牌簡介\n以手工皮革聞名");
    expect(r.text).toBe("品牌簡介\n以手工皮革聞名");
    expect(r.substitutions).toContain("markdown:heading");
  });

  it("strips list markers", () => {
    const r = localizeToTW("- 手工皮革\n- 台灣設計");
    expect(r.text).toBe("手工皮革\n台灣設計");
    expect(r.substitutions).toContain("markdown:list");
  });
});

describe("localizeToTW — emoji removal", () => {
  it("strips emoji from text", () => {
    const r = localizeToTW("台灣品牌🎉專注設計✨");
    expect(r.text).toBe("台灣品牌專注設計");
    expect(r.substitutions).toContain("emoji:removed");
  });

  it("preserves text with no emoji", () => {
    const r = localizeToTW("台灣品牌專注設計");
    expect(r.text).toBe("台灣品牌專注設計");
  });
});

describe("stripAiToolArtifacts", () => {
  it("strips utm_source=chatgpt.com from URLs", () => {
    const r = stripAiToolArtifacts(
      "https://example.com?utm_source=chatgpt.com&ref=1",
    );
    expect(r).toBe("https://example.com?ref=1");
  });

  it("strips utm_source=openai from URLs", () => {
    const r = stripAiToolArtifacts("https://example.com?utm_source=openai");
    expect(r).toBe("https://example.com");
  });

  it("strips referrer=grok.com from URLs", () => {
    const r = stripAiToolArtifacts("https://example.com?referrer=grok.com");
    expect(r).toBe("https://example.com");
  });

  it("strips turn0search placeholder codes", () => {
    const r = stripAiToolArtifacts("根據 turn0search0 的結果");
    expect(r).toBe("根據  的結果");
  });

  it("strips citeturn codes", () => {
    const r = stripAiToolArtifacts("資料來源 citeturn0news2 顯示");
    expect(r).toBe("資料來源  顯示");
  });

  it("preserves author UTM parameters", () => {
    const r = stripAiToolArtifacts("https://example.com?utm_source=newsletter");
    expect(r).toBe("https://example.com?utm_source=newsletter");
  });

  it("returns unchanged text with no artifacts", () => {
    const r = stripAiToolArtifacts("一般的品牌描述文字");
    expect(r).toBe("一般的品牌描述文字");
  });
});
