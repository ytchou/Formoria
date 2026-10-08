import { describe, expect, it } from "vitest";
import { buildDescriptionRetryInstruction } from "./description-rewrite";

const zhRejection = (reasons: string[], attempt = 1) => [
  { field: "description_zh" as const, reasons, warnings: [], attempt },
];

describe("buildDescriptionRetryInstruction", () => {
  it("tells the model to LENGTHEN when the zh description fell under the band", () => {
    // The regression this exists for: attempt 1 came back at 125 字 and the old
    // retry made attempt 2 shorter (101 字) because it never said which bound broke.
    const instruction = buildDescriptionRetryInstruction(
      zhRejection(["length_band"]),
      {
        description_zh: "短".repeat(125),
      },
    );
    expect(instruction).toContain("目前 125 字");
    expect(instruction).toContain("少於下限 150");
    expect(instruction).toContain("增加");
    expect(instruction).toContain("至少 25 字");
    expect(instruction).not.toContain("刪減");
  });

  it("tells the model to SHORTEN when the zh description ran over the band", () => {
    const instruction = buildDescriptionRetryInstruction(
      zhRejection(["length_band"]),
      {
        description_zh: "長".repeat(450),
      },
    );
    expect(instruction).toContain("目前 450 字");
    expect(instruction).toContain("超過上限 400");
    expect(instruction).toContain("刪減");
    expect(instruction).toContain("至少 50 字");
    expect(instruction).not.toContain("增加");
  });

  it("uses each field's own band and unit", () => {
    const instruction = buildDescriptionRetryInstruction(
      [
        {
          field: "description_en",
          reasons: ["length_band"],
          warnings: [],
          attempt: 1,
        },
      ],
      { description_en: "x".repeat(120) },
    );
    expect(instruction).toContain("120 characters");
    expect(instruction).toContain("少於下限 300");
  });

  it("falls back to naming the band when the value is unavailable", () => {
    const instruction = buildDescriptionRetryInstruction(
      zhRejection(["length_band"]),
      null,
    );
    expect(instruction).toContain("150-400");
    expect(instruction).not.toContain("目前");
  });

  it("maps non-length reasons to the edit that clears them", () => {
    const instruction = buildDescriptionRetryInstruction(
      zhRejection(["language_purity", "pricing_information"]),
      { description_zh: "內容".repeat(100) },
    );
    expect(instruction).toContain("連續拉丁字母單詞不可超過 2 個");
    expect(instruction).toContain("移除所有售價");
  });

  it("tells the model to keep model numbers half-width (DEV-1954)", () => {
    const instruction = buildDescriptionRetryInstruction(
      zhRejection(["fullwidth_alphanumeric"]),
      { description_zh: "吸塵器ＭＤ－８６０Ｓ" },
    );
    expect(instruction).toContain("含全形英數字");
    expect(instruction).toContain("MD-860S");
    expect(instruction).toContain("不可改成全形字母或國字數字");
    expect(instruction).not.toContain("未通過檢查：fullwidth_alphanumeric");
  });

  it("no longer asks the model to rewrite foreign proper nouns into Chinese", () => {
    // The old wording is what taught the model to full-width model numbers.
    const instruction = buildDescriptionRetryInstruction(
      zhRejection(["language_purity"]),
      { description_zh: "內容".repeat(100) },
    );
    expect(instruction).not.toContain("改寫為中文");
    expect(instruction).toContain("保留半形原文");
    expect(instruction).toContain("型號、規格與標準名稱在兩種語言中都保留半形原文");
  });

  it("returns no instruction when every rejection was a soft warning", () => {
    expect(
      buildDescriptionRetryInstruction(
        [
          {
            field: "description_en",
            reasons: [],
            warnings: ["length_band"],
            attempt: 1,
          },
        ],
        { description_en: "x".repeat(120) },
      ),
    ).toBe("");
  });

  it("returns no instruction when nothing was rejected", () => {
    expect(buildDescriptionRetryInstruction([], {})).toBe("");
  });

  it("groups several reasons for the same field onto one line", () => {
    const instruction = buildDescriptionRetryInstruction(
      [
        {
          field: "description_zh",
          reasons: ["length_band"],
          warnings: [],
          attempt: 1,
        },
        {
          field: "blurb_zh",
          reasons: ["language_purity"],
          warnings: [],
          attempt: 1,
        },
      ],
      { description_zh: "短".repeat(100), blurb_zh: "all latin words here" },
    );
    const lines = instruction
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("description_zh");
    expect(lines[1]).toContain("blurb_zh");
  });
});
