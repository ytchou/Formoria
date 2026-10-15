import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { withBreaks } from "../with-breaks";

const markup = (text: string, offsets?: readonly number[]) =>
  renderToStaticMarkup(<>{withBreaks(text, offsets)}</>);

describe("withBreaks", () => {
  it("puts a <wbr> at each offset", () => {
    expect(markup("木質托盤・小", [2, 5])).toBe("木質<wbr/>托盤・<wbr/>小");
  });

  it("orders and dedupes offsets, and ignores any outside the text", () => {
    expect(markup("木質托盤", [2, 2, 0, 4, 9, -1])).toBe("木質<wbr/>托盤");
  });

  it("returns the plain string when there is nothing to break", () => {
    expect(withBreaks("手沖壺", [])).toBe("手沖壺");
    expect(withBreaks("手沖壺", undefined)).toBe("手沖壺");
    expect(withBreaks("手沖壺", [0, 3])).toBe("手沖壺");
  });
});
