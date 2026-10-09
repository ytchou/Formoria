import { describe, expect, it } from "vitest";
import { splitLede } from "../split-lede";

describe("splitLede", () => {
  it("splits zh at the first 。 and keeps the rest as the story", () => {
    expect(
      splitLede("簡單製作是嘉義的木作工作室。從一張書桌開始。\n\n後來也做燈具。", "zh-TW"),
    ).toEqual({
      lede: "簡單製作是嘉義的木作工作室。",
      rest: "從一張書桌開始。\n\n後來也做燈具。",
    });
  });

  it("splits zh at ！ and ？ too", () => {
    expect(splitLede("你用過手工皂嗎？我們做了十年。", "zh-TW").lede).toBe(
      "你用過手工皂嗎？",
    );
    expect(splitLede("歡迎來到工作室！這裡做陶。", "zh-TW").lede).toBe(
      "歡迎來到工作室！",
    );
  });

  it("keeps a closing quote with the zh sentence it ends", () => {
    expect(splitLede("品牌名稱取自「慢慢來。」後來成了口號。", "zh-TW")).toEqual({
      lede: "品牌名稱取自「慢慢來。」",
      rest: "後來成了口號。",
    });
  });

  it("does not split zh at a Latin period", () => {
    expect(splitLede("我們使用 1.5mm 鋼板. 再手工打磨。之後上漆。", "zh-TW").lede).toBe(
      "我們使用 1.5mm 鋼板. 再手工打磨。",
    );
  });

  it("splits EN at . ! ? followed by whitespace", () => {
    expect(
      splitLede("Simply Made is a woodwork studio in Chiayi. It started with one desk.", "en"),
    ).toEqual({
      lede: "Simply Made is a woodwork studio in Chiayi.",
      rest: "It started with one desk.",
    });
    expect(splitLede("Ever tried handmade soap? We have made it for ten years.", "en").lede).toBe(
      "Ever tried handmade soap?",
    );
  });

  it("never splits inside a decimal or a model number", () => {
    expect(
      splitLede("The MD-860S weighs 1.5 kg and runs 40 min. It shipped in 2012.", "en").lede,
    ).toBe("The MD-860S weighs 1.5 kg and runs 40 min.");
  });

  it("never splits inside a name containing a period", () => {
    expect(
      splitLede("Mr.Casa makes furniture in Taipei. Every piece is made to order.", "en").lede,
    ).toBe("Mr.Casa makes furniture in Taipei.");
    expect(
      splitLede("Tan.Nichi and golday.jewelry are separate brands. Both sell online.", "en").lede,
    ).toBe("Tan.Nichi and golday.jewelry are separate brands.");
  });

  it("skips abbreviations and initials followed by a space", () => {
    expect(
      splitLede("Founded by Dr. Lin and J. Chen in 2010. They make lamps.", "en").lede,
    ).toBe("Founded by Dr. Lin and J. Chen in 2010.");
  });

  it("uses full-width terminators on EN pages that fall back to zh text", () => {
    expect(splitLede("嘉義的木作工作室。從一張書桌開始。", "en").lede).toBe(
      "嘉義的木作工作室。",
    );
  });

  it("renders no lede for a single-sentence description", () => {
    expect(splitLede("嘉義的木作工作室。", "zh-TW")).toEqual({
      lede: null,
      rest: "嘉義的木作工作室。",
    });
    expect(splitLede("A woodwork studio in Chiayi.", "en")).toEqual({
      lede: null,
      rest: "A woodwork studio in Chiayi.",
    });
  });

  it("renders no lede when there is no clean boundary", () => {
    expect(splitLede("嘉義的木作工作室，從一張書桌開始", "zh-TW").lede).toBeNull();
    expect(splitLede("品牌故事\n\n嘉義的木作工作室。從書桌開始。", "zh-TW").lede).toBeNull();
  });

  it("renders no lede when the first sentence is too long", () => {
    const longZh = `${"木".repeat(81)}。第二句。`;
    expect(splitLede(longZh, "zh-TW")).toEqual({ lede: null, rest: longZh });
    expect(splitLede(`${"木".repeat(79)}。第二句。`, "zh-TW").lede).not.toBeNull();

    const longEn = `${"word ".repeat(44)}end. Second sentence.`;
    expect(splitLede(longEn, "en").lede).toBeNull();
  });

  it("gives EN a wider budget than zh (about 3 lines in the hero column)", () => {
    // ~180 Latin characters: past the zh budget, inside the EN one.
    const en180 = `${"word ".repeat(35)}end. Second sentence.`;
    expect(splitLede(en180, "en").lede).toBe(`${"word ".repeat(35)}end.`);

    // ~240 Latin characters: past the EN budget.
    const en240 = `${"word ".repeat(47)}end. Second sentence.`;
    expect(splitLede(en240, "en")).toEqual({ lede: null, rest: en240 });
  });

  it("keeps the zh budget at 160 width units", () => {
    expect(splitLede(`${"木".repeat(81)}。第二句。`, "zh-TW").lede).toBeNull();
    expect(splitLede(`${"木".repeat(79)}。第二句。`, "zh-TW").lede).not.toBeNull();
  });

  it("uses the fallback lede when the first sentence is too long", () => {
    const en240 = `${"word ".repeat(47)}end. Second sentence.`;
    expect(
      splitLede(en240, "en", { fallbackLede: "  A woodwork studio in Chiayi.  " }),
    ).toEqual({ lede: "A woodwork studio in Chiayi.", rest: en240 });
  });

  it("uses the fallback lede when there is no split", () => {
    expect(
      splitLede("A woodwork studio in Chiayi.", "en", { fallbackLede: "Desks and lamps." }),
    ).toEqual({ lede: "Desks and lamps.", rest: "A woodwork studio in Chiayi." });
  });

  it("ignores the fallback when the description yields a lede", () => {
    expect(
      splitLede("Simply Made is a woodwork studio. It makes desks.", "en", {
        fallbackLede: "Desks and lamps.",
      }),
    ).toEqual({ lede: "Simply Made is a woodwork studio.", rest: "It makes desks." });
  });

  it("ignores an empty or missing fallback", () => {
    expect(splitLede("A woodwork studio in Chiayi.", "en", { fallbackLede: "   " }).lede).toBeNull();
    expect(splitLede("A woodwork studio in Chiayi.", "en", { fallbackLede: null }).lede).toBeNull();
  });
});
