import { describe, expect, it } from "vitest";

import { phraseBreakOffsets } from "./phrase-break-offsets";

/** The text with a `|` at each offset, so a failure reads as the breaks. */
function marked(text: string): string {
  const offsets = phraseBreakOffsets(text);
  let out = "";
  let start = 0;
  for (const offset of offsets) {
    out += `${text.slice(start, offset)}|`;
    start = offset;
  }
  return out + text.slice(start);
}

describe("phraseBreakOffsets", () => {
  it("breaks between dictionary words, never inside one", () => {
    expect(marked("台灣中小企業的規模")).toBe("台灣|中小企業|的|規模");
  });

  it("adds no break next to punctuation, which can already break", () => {
    const out = marked("書桌：每天坐下來的那張桌子");
    expect(out.startsWith("書桌：每天")).toBe(true);
    expect(out).not.toContain("|：");
  });

  it.each(["・", "／", "/", "×"])("breaks after %s in a zh name", (sep) => {
    expect(phraseBreakOffsets(`木質托盤${sep}小`)).toContain(5);
  });

  it("breaks after every separator in a compound name", () => {
    const offsets = phraseBreakOffsets("Orii×DO / T 托盤");
    expect(offsets).toContain("Orii×".length);
    expect(offsets).toContain("Orii×DO /".length);
  });

  it("adds no break after a trailing separator", () => {
    expect(phraseBreakOffsets("托盤・")).not.toContain("托盤・".length);
  });

  it("adds one break after a doubled separator, not between the two", () => {
    const offsets = phraseBreakOffsets("托盤//小");
    expect(offsets).not.toContain(3);
    expect(offsets).toContain(4);
  });

  it("returns sorted, unique offsets inside the text", () => {
    const text = "Handscript 手稿藝術家系列鋼珠筆・黑";
    const offsets = phraseBreakOffsets(text);
    expect(offsets).toEqual([...new Set(offsets)].sort((a, b) => a - b));
    for (const offset of offsets) {
      expect(offset).toBeGreaterThan(0);
      expect(offset).toBeLessThan(text.length);
    }
  });

  it("returns [] for text with no Han, separators included", () => {
    expect(phraseBreakOffsets("Desk setup")).toEqual([]);
    expect(phraseBreakOffsets("Orii×DO / T")).toEqual([]);
    expect(phraseBreakOffsets("")).toEqual([]);
  });
});
