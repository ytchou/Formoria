import { describe, expect, it } from "vitest";
import { localizeToTW, stripAiToolArtifacts } from "./taiwan-localization";

const FORMATTING_LABEL = /^(markdown|emoji|punctuation):/u;

describe("localizeToTW — no vocabulary substitution", () => {
  it("leaves 審核通過 unchanged", () => {
    const r = localizeToTW("審核通過");
    expect(r.text).toBe("審核通過");
    expect(r.substitutions).toEqual([]);
  });

  it("leaves 支持台灣製造 unchanged", () => {
    const r = localizeToTW("支持台灣製造");
    expect(r.text).toBe("支持台灣製造");
    expect(r.substitutions).toEqual([]);
  });

  it("leaves 落地燈 unchanged", () => {
    const r = localizeToTW("落地燈");
    expect(r.text).toBe("落地燈");
    expect(r.substitutions).toEqual([]);
  });

  it("leaves other formerly-substituted terms unchanged", () => {
    for (const source of ["程序", "點擊", "視頻", "質量", "信息", "用戶"]) {
      const r = localizeToTW(source);
      expect(r.text).toBe(source);
      expect(r.substitutions).toEqual([]);
    }
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

  it("returns empty substitutions for plain text", () => {
    const r = localizeToTW("台灣品牌以品質著稱");
    expect(r.text).toBe("台灣品牌以品質著稱");
    expect(r.substitutions).toEqual([]);
  });

  it("handles empty string", () => {
    const r = localizeToTW("");
    expect(r.text).toBe("");
    expect(r.substitutions).toEqual([]);
  });
});

describe("localizeToTW — punctuation", () => {
  it("normalizes half-width punctuation between CJK characters", () => {
    const r = localizeToTW("品牌,設計:好;用!");
    expect(r.text).toBe("品牌，設計：好；用！");
    expect(r.substitutions).toContain("punctuation:normalized");
  });

  it("preserves half-width punctuation in English context", () => {
    const r = localizeToTW("Hello, world! 你好");
    expect(r.text).toContain("Hello, world!");
  });

  it("normalizes ellipsis to ⋯⋯", () => {
    const r = localizeToTW("品牌創立於2015年...至今已十年");
    expect(r.text).toBe("品牌創立於2015年⋯⋯至今已十年");
  });

  it("normalizes half-width period at CJK sentence end", () => {
    const r = localizeToTW("這是台灣品牌.");
    expect(r.text).toBe("這是台灣品牌。");
  });

  it("normalizes parentheses between CJK characters", () => {
    const r = localizeToTW("台灣(品牌)設計");
    expect(r.text).toBe("台灣（品牌）設計");
  });

  it("normalizes question marks adjacent to CJK", () => {
    const r = localizeToTW("這是台灣品牌?");
    expect(r.text).toBe("這是台灣品牌？");
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
