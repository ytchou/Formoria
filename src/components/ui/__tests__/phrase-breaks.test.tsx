import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { phraseBreaks } from "../phrase-breaks";

const markup = (text: string) => renderToStaticMarkup(<>{phraseBreaks(text)}</>);

describe("phraseBreaks", () => {
  it("puts a break between words, never inside one", () => {
    expect(markup("台灣中小企業的規模")).toBe("台灣<wbr/>中小企業<wbr/>的<wbr/>規模");
  });

  it("adds no break next to punctuation, which can already break", () => {
    const out = markup("書桌：每天坐下來的那張桌子");
    expect(out.startsWith("書桌：每天")).toBe(true);
    expect(out).not.toContain("<wbr/>：");
  });

  it("returns text without Han characters unchanged", () => {
    expect(phraseBreaks("Desk setup")).toBe("Desk setup");
  });
});
