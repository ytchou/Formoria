import { describe, expect, it } from "vitest";

import {
  BANNED_TERMS,
  detectBannedTerms,
  fixBannedTerms,
} from "@/lib/i18n/banned-terms";

describe("detectBannedTerms", () => {
  it("detects a banned term and reports term, replacement, and offset", () => {
    const hits = detectBannedTerms("這個視頻很好");

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      term: "視頻",
      replacement: "影片",
      offset: 2,
    });
  });

  it("never mutates the input string", () => {
    const input = "這個視頻很好";
    const hits = detectBannedTerms(input);

    expect(input).toBe("這個視頻很好");
    expect(hits).toHaveLength(1);
  });

  it("does not flag 算法 inside 演算法", () => {
    expect(detectBannedTerms("這個演算法")).toHaveLength(0);
  });

  it("flags bare 算法", () => {
    const hits = detectBannedTerms("這個算法");

    expect(hits).toHaveLength(1);
    expect(hits[0]?.term).toBe("算法");
  });

  it("does not flag the excluded terms", () => {
    const excluded = [
      "點擊",
      "支持",
      "保存",
      "項目",
      "文件",
      "社區",
      "數據",
      "打造",
      "通過",
      "水平",
      "落地",
      "程序",
      "土豆",
      "干貨",
      "乾貨",
      "優化",
      "智能",
      "智能體",
      "人工智能",
    ];

    for (const term of excluded) {
      expect(detectBannedTerms(term), term).toEqual([]);
    }
  });
});

describe("fixBannedTerms", () => {
  it("swaps every hit", () => {
    const result = fixBannedTerms("這個視頻很好");

    expect(result.text).toBe("這個影片很好");
    expect(result.substitutions).toHaveLength(1);
    expect(result.substitutions[0]?.term).toBe("視頻");
  });

  it("returns the input unchanged when there is nothing to fix", () => {
    const result = fixBannedTerms("這個演算法很好");

    expect(result.text).toBe("這個演算法很好");
    expect(result.substitutions).toEqual([]);
  });
});

describe("BANNED_TERMS", () => {
  it("has exactly 88 entries with unique terms", () => {
    expect(BANNED_TERMS).toHaveLength(88);

    const terms = BANNED_TERMS.map((entry) => entry.term);
    expect(new Set(terms).size).toBe(terms.length);
  });
});
