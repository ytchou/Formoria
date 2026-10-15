// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { separatorBreaks } from "../separator-breaks";

function renderName(name: string) {
  const { node, hasBreaks } = separatorBreaks(name);
  const { container } = render(<span>{node}</span>);
  const span = container.querySelector("span")!;
  return { span, hasBreaks, html: span.innerHTML };
}

describe("separatorBreaks", () => {
  it.each(["・", "／", "/", "×"])("breaks after %s in a zh name", (sep) => {
    const { span, hasBreaks, html } = renderName(`木質托盤${sep}小`);
    expect(hasBreaks).toBe(true);
    expect(html).toBe(`木質托盤${sep}<wbr>小`);
    expect(span.textContent).toBe(`木質托盤${sep}小`);
  });

  it("breaks after every separator in a compound name", () => {
    const { html } = renderName("Orii×DO / T 托盤");
    expect(html).toBe("Orii×<wbr>DO /<wbr> T 托盤");
  });

  it("adds no break after a trailing separator", () => {
    const { hasBreaks, html } = renderName("托盤・");
    expect(hasBreaks).toBe(false);
    expect(html).toBe("托盤・");
  });

  it("passes a zh name without separators through unchanged", () => {
    const { node, hasBreaks } = separatorBreaks("手沖壺");
    expect(node).toBe("手沖壺");
    expect(hasBreaks).toBe(false);
  });

  it("passes a Latin name through unchanged, separators included", () => {
    for (const name of ["Pour-over kettle", "Orii×DO / T"]) {
      const { node, hasBreaks } = separatorBreaks(name);
      expect(node).toBe(name);
      expect(hasBreaks).toBe(false);
    }
  });
});
